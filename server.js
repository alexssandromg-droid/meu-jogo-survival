const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// === CONFIGURAÇÕES ===
let gameConfig = {
    maxJogadores: 20,
    vidasIniciais: 2,
    velocidadeBot: 500,
    fatorPortas: 1.2
};

let jogadores = {}; 
let salasData = [];
let jogoAndando = false;
let ordemTurno = [];
let turnoIndex = 0;
let timerTurno = null;
let faseAtual = 1;
let hallDaFama = [];

// Variáveis Votação e Apostas
let votosComputados = {}; 
let jaVotaram = [];
let apostas = {}; // { idApostador: idCandidatoEscolhido }

// Variáveis Tabuleiro
let boardAtivo = false;
let boardPlayers = []; 
let boardPositions = {};
let boardTurn = 0; 
const BOARD_SIZE = 20;

// === AUXILIARES ===
function iniciarSalas(qtdJogadores) {
    let qtdPortas = Math.ceil(qtdJogadores * gameConfig.fatorPortas);
    if(qtdPortas < qtdJogadores) qtdPortas = qtdJogadores;

    let conteudos = [];
    let qtdEscudo = Math.max(2, Math.floor(qtdPortas * 0.20)); 
    let qtdVida = Math.floor(qtdPortas * 0.10);
    let qtdGas = Math.floor(qtdPortas * 0.10); 

    for(let i=0; i<qtdEscudo; i++) conteudos.push('escudo');
    for(let i=0; i<qtdVida; i++) conteudos.push('vida');
    for(let i=0; i<qtdGas; i++) conteudos.push('gas');
    
    while(conteudos.length < qtdPortas) { conteudos.push('vazio'); }
    conteudos.sort(() => Math.random() - 0.5);

    return conteudos.map((tipo, index) => ({
        id: index + 1, tipo: tipo, ocupante: null, bloqueada: false
    }));
}

function atualizarContadorOnline() {
    io.emit('jogadoresOnline', io.engine.clientsCount);
}

// === FLUXO DO JOGO ===

function processarProximoTurno() {
    if(!jogoAndando || boardAtivo) return;
    clearTimeout(timerTurno);

    if(turnoIndex >= ordemTurno.length) {
        let vivos = Object.values(jogadores).filter(j => j.vivo);
        if(vivos.length > 1) {
            iniciarFaseVotacao(null);
        } else {
            faseExplosao(null); 
        }
        return;
    }

    let jogadorAtual = ordemTurno[turnoIndex];
    if(!jogadorAtual || !jogadorAtual.vivo) {
        turnoIndex++;
        processarProximoTurno();
        return;
    }

    io.emit('mudancaDeTurno', { 
        idJogador: jogadorAtual.id, nome: jogadorAtual.nome, tempo: 10
    });

    if(jogadorAtual.ehBot) {
        timerTurno = setTimeout(() => { jogadaDoBot(jogadorAtual); }, gameConfig.velocidadeBot);
    } else {
        timerTurno = setTimeout(() => {
            io.emit('mensagem', { texto: `${jogadorAtual.nome} DORMIU!`, cor: "red" });
            jogadaDoBot(jogadorAtual);
        }, 10000);
    }
}

function jogadaDoBot(jogador) {
    let salasLivres = salasData.filter(s => !s.bloqueada);
    if(salasLivres.length > 0) {
        let escolha = salasLivres[Math.floor(Math.random() * salasLivres.length)];
        resolverEntrada(escolha.id, jogador.id);
    } else {
        turnoIndex++;
        processarProximoTurno();
    }
}

function resolverEntrada(idSala, idJogador) {
    let sala = salasData.find(s => s.id === idSala);
    let jogador = jogadores[idJogador];

    if(sala && !sala.bloqueada && jogador) {
        clearTimeout(timerTurno);
        sala.bloqueada = true;
        sala.ocupante = jogador.nome;
        jogador.sala = idSala;

        if(sala.tipo === 'gas') jogador.vidas -= 1;
        else if(sala.tipo === 'vida') jogador.vidas += 1;
        else if(sala.tipo === 'escudo') jogador.temEscudo = true;

        if(jogador.vidas <= 0) jogador.vivo = false;

        io.emit('salaOcupada', { idSala: idSala, jogador: jogador, efeito: sala.tipo });
        io.emit('atualizarLista', Object.values(jogadores));

        turnoIndex++;
        setTimeout(processarProximoTurno, 600);
    }
}

// 2. FASE DE VOTAÇÃO
function iniciarFaseVotacao(empatados) {
    votosComputados = {};
    jaVotaram = [];
    
    io.emit('mensagem', { texto: "🗳️ VOTAÇÃO INICIADA!", cor: "#00b0ff" });
    let candidatos = empatados ? empatados : Object.values(jogadores).filter(j => j.vivo);
    
    if(candidatos.length === 0) { faseExplosao(null); return; }

    io.emit('abrirVotacao', candidatos);

    Object.values(jogadores).filter(j => j.ehBot).forEach(bot => {
        setTimeout(() => {
            let alvo = candidatos[Math.floor(Math.random() * candidatos.length)];
            if(alvo) registrarVoto(bot.id, alvo.id);
        }, Math.random() * 2000 + 500);
    });
}

function registrarVoto(idEleitor, idAlvo) {
    if(jaVotaram.includes(idEleitor)) return;
    if(!votosComputados[idAlvo]) votosComputados[idAlvo] = 0;
    votosComputados[idAlvo]++;
    jaVotaram.push(idEleitor);

    let totalJogadores = Object.keys(jogadores).length;
    io.emit('progressoVotacao', { atual: jaVotaram.length, total: totalJogadores });

    if(jaVotaram.length >= totalJogadores) {
        setTimeout(finalizarVotacao, 1000);
    }
}

function finalizarVotacao() {
    io.emit('fecharVotacao');
    let rankingVotos = Object.keys(votosComputados).sort((a,b) => votosComputados[b] - votosComputados[a]);
    
    if(rankingVotos.length === 0) {
        io.emit('mensagem', { texto: "NINGUÉM VOTOU...", cor: "yellow" });
        iniciarNovaRodada(Object.values(jogadores).filter(j=>j.vivo));
        return;
    }

    let id1 = rankingVotos[0];
    let id2 = rankingVotos[1];

    if(id2) {
        // VAMOS PARA AS APOSTAS ANTES DO TABULEIRO
        iniciarFaseApostas(jogadores[id1], jogadores[id2]);
    } else {
        faseExplosao(jogadores[id1]);
    }
}

// 3. FASE DE APOSTAS (NOVO)
function iniciarFaseApostas(p1, p2) {
    if(!p1 || !p2) { faseExplosao(null); return; }
    
    apostas = {};
    io.emit('mensagem', { texto: `💸 FAÇAM SUAS APOSTAS! QUEM VENCE?`, cor: "#00e676" });
    io.emit('abrirApostasUI', { p1: p1, p2: p2 });

    // Bots fazem apostas
    Object.values(jogadores).filter(j => j.ehBot && j.id !== p1.id && j.id !== p2.id && j.vivo).forEach(bot => {
        setTimeout(() => {
            // Bot aposta aleatorio
            let apostaBot = (Math.random() > 0.5) ? p1.id : p2.id;
            apostas[bot.id] = apostaBot;
        }, 2000);
    });

    // Tempo para apostar: 8 segundos
    setTimeout(() => {
        io.emit('fecharApostasUI');
        iniciarBoardGame(p1, p2);
    }, 8000);
}

// 4. JOGO DO TABULEIRO
function iniciarBoardGame(p1, p2) {
    boardAtivo = true;
    boardPlayers = [p1, p2];
    boardPositions = {};
    boardPositions[p1.id] = 0;
    boardPositions[p2.id] = 0;
    boardTurn = 0; 

    io.emit('mensagem', { texto: `🎲 CORRIDA: ${p1.nome} VS ${p2.nome}`, cor: "#ff9100" });
    io.emit('iniciarBoardUI', { p1: p1, p2: p2, tamanho: BOARD_SIZE });

    processarTurnoBoard();
}

function processarTurnoBoard() {
    if(!boardAtivo) return;
    let atual = boardPlayers[boardTurn];
    io.emit('vezBoard', { id: atual.id, nome: atual.nome });

    if(atual.ehBot && atual.vivo) {
        setTimeout(() => rolarDado(atual.id), 1500);
    }
}

function rolarDado(idSolicitante) {
    if(!boardAtivo) return;
    let atual = boardPlayers[boardTurn];
    if(atual.id !== idSolicitante) return;

    let dado = Math.floor(Math.random() * 6) + 1;
    let novaPos = boardPositions[atual.id] + dado;
    let msgExtra = "";
    
    if(novaPos === 13) { novaPos -= 3; msgExtra = " (AZAR!)"; }
    if(novaPos === 7) { novaPos += 2; msgExtra = " (SORTE!)"; }

    if(novaPos > BOARD_SIZE) novaPos = BOARD_SIZE;
    boardPositions[atual.id] = novaPos;

    io.emit('dadoRolado', { id: atual.id, dado: dado, pos: novaPos, msg: msgExtra });

    if(novaPos >= BOARD_SIZE) {
        // TEMOS UM VENCEDOR
        boardAtivo = false;
        let vencedor = atual;
        let perdedor = boardPlayers.find(p => p.id !== atual.id);
        
        io.emit('mensagem', { texto: `🏁 ${vencedor.nome} VENCEU A CORRIDA!`, cor: "#00e676" });
        
        setTimeout(() => {
            resolverResultadoFinal(vencedor, perdedor);
        }, 2000);

    } else {
        boardTurn = (boardTurn === 0) ? 1 : 0;
        setTimeout(processarTurnoBoard, 1000);
    }
}

// 5. RESOLUÇÃO DE MORTES (DUELO + APOSTAS)
function resolverResultadoFinal(vencedor, perdedor) {
    // 1. Mata o perdedor do duelo
    perdedor.vivo = false;
    perdedor.vidas = 0;
    io.emit('efeitoKill', { idVitima: perdedor.id });
    io.emit('mensagem', { texto: `💥 ${perdedor.nome} EXPLODIU NO PAREDÃO!`, cor: "red" });

    // 2. Verifica as apostas
    let listaApostadores = Object.values(jogadores).filter(j => j.vivo && j.id !== vencedor.id && j.id !== perdedor.id);
    
    listaApostadores.forEach(apostador => {
        let voto = apostas[apostador.id];
        
        if(voto !== vencedor.id) {
            // APOSTOU ERRADO (ou não apostou)
            if(apostador.temEscudo) {
                apostador.temEscudo = false;
                io.emit('mensagem', { texto: `🛡️ ${apostador.nome} ERROU A APOSTA MAS SE SALVOU!`, cor: "#ffd700" });
                io.emit('efeitoDefesa', { idVitima: apostador.id });
            } else {
                apostador.vivo = false;
                apostador.vidas = 0;
                io.emit('mensagem', { texto: `💸 ${apostador.nome} PERDEU A APOSTA E MORREU!`, cor: "red" });
                io.emit('efeitoKill', { idVitima: apostador.id });
            }
        } else {
            // APOSTOU CERTO
            // Poderia ganhar vida extra aqui se quisesse, mas sobreviver já é lucro
        }
    });

    io.emit('atualizarLista', Object.values(jogadores));
    
    // Verifica Fim de Jogo
    let vivos = Object.values(jogadores).filter(j => j.vivo);
    setTimeout(() => {
        if(vivos.length <= 1) {
            jogoAndando = false;
            let campeao = vivos[0] ? vivos[0] : { nome: "NINGUÉM", tipo: "bot" };
            if(campeao.nome !== "NINGUÉM") {
                hallDaFama.unshift({ nome: campeao.nome, data: new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) });
                if(hallDaFama.length>5) hallDaFama.pop();
            }
            io.emit('fimDeJogo', { campeao: campeao });
            io.emit('atualizarRanking', hallDaFama);
        } else {
            iniciarNovaRodada(vivos);
        }
    }, 4000);
}

function faseExplosao(eliminado) {
    // Usado apenas se for eliminação direta sem duelo (raro agora)
    if(eliminado) {
        if(eliminado.temEscudo) {
            eliminado.temEscudo = false;
            io.emit('mensagem', { texto: `🛡️ ${eliminado.nome} SOBREVIVEU COM ESCUDO!`, cor: "#ffd700" });
        } else {
            eliminado.vivo = false;
            io.emit('mensagem', { texto: `💥 ${eliminado.nome} ELIMINADO!`, cor: "red" });
        }
    }
    io.emit('atualizarLista', Object.values(jogadores));
    
    // Reinicia
    let vivos = Object.values(jogadores).filter(j => j.vivo);
    setTimeout(() => {
        if(vivos.length <= 1) {
            let campeao = vivos[0] ? vivos[0] : { nome: "NINGUÉM", tipo: "bot" };
            io.emit('fimDeJogo', { campeao: campeao });
        } else {
            iniciarNovaRodada(vivos);
        }
    }, 3000);
}

function iniciarNovaRodada(sobreviventes) {
    faseAtual++;
    sobreviventes.forEach(j => { j.sala = null; j.temEscudo = false; });
    
    let vivos = Object.values(jogadores).filter(j => j.vivo);
    salasData = iniciarSalas(vivos.length);
    ordemTurno = vivos.sort(() => Math.random() - 0.5);
    turnoIndex = 0;

    io.emit('novaRodada', { fase: faseAtual, salas: salasData, jogadores: Object.values(jogadores) });
    setTimeout(processarProximoTurno, 1000);
}

// === CONEXÃO ===
io.on('connection', (socket) => {
    atualizarContadorOnline();
    socket.emit('atualizarRanking', hallDaFama);
    socket.emit('configAtual', gameConfig);

    socket.on('adminLogin', (s) => socket.emit('adminLogado', s === 'admin'));
    socket.on('adminSalvarConfig', (n) => {
        if(n.maxJogadores) gameConfig.maxJogadores = parseInt(n.maxJogadores);
        if(n.vidasIniciais) gameConfig.vidasIniciais = parseInt(n.vidasIniciais);
        if(n.velocidadeBot) gameConfig.velocidadeBot = parseInt(n.velocidadeBot);
        if(n.fatorPortas) gameConfig.fatorPortas = parseFloat(n.fatorPortas);
        io.emit('mensagem', { texto: "⚙️ REGRAS ATUALIZADAS!", cor: "#00e676" });
    });
    socket.on('adminZerarRank', () => { hallDaFama = []; io.emit('atualizarRanking', hallDaFama); });

    socket.on('entrar', (dados) => {
        jogadores[socket.id] = {
            id: socket.id, nome: dados.nome, tipo: dados.tipo,
            vidas: gameConfig.vidasIniciais, temEscudo: false, sala: null, vivo: true, ehBot: false
        };
        io.emit('atualizarLista', Object.values(jogadores));
    });

    socket.on('iniciarJogo', () => {
        if(jogoAndando) return;
        let lista = Object.values(jogadores);
        let qtdFaltante = gameConfig.maxJogadores - lista.length;
        if(qtdFaltante < 0) qtdFaltante = 0;

        for(let i=1; i<=qtdFaltante; i++) {
            let idBot = `bot-${Date.now()}-${i}`;
            jogadores[idBot] = {
                id: idBot, nome: `Bot ${i}`, tipo: 'bot',
                vidas: gameConfig.vidasIniciais, temEscudo: false, sala: null, vivo: true, ehBot: true
            };
        }
        
        let vivos = Object.values(jogadores);
        salasData = iniciarSalas(vivos.length);
        ordemTurno = vivos.sort(() => Math.random() - 0.5);
        turnoIndex = 0;
        jogoAndando = true;
        faseAtual = 1;
        io.emit('inicioDePartida', { salas: salasData, jogadores: vivos });
        setTimeout(processarProximoTurno, 1000);
    });

    socket.on('jogarTurno', (idSala) => {
        let jogadorDaVez = ordemTurno[turnoIndex];
        if(jogadorDaVez && jogadorDaVez.id === socket.id) {
            resolverEntrada(idSala, socket.id);
        }
    });

    socket.on('enviarVoto', (idAlvo) => {
        if(jogadores[socket.id]) registrarVoto(socket.id, idAlvo);
    });

    // INPUT APOSTA
    socket.on('fazerAposta', (idCandidato) => {
        apostas[socket.id] = idCandidato;
    });

    // INPUT DO DADO
    socket.on('pedirDado', () => {
        if(boardAtivo) rolarDado(socket.id);
    });

    socket.on('disconnect', () => {
        if(jogadores[socket.id]) { jogadores[socket.id].vivo = false; delete jogadores[socket.id]; }
        let humanos = Object.values(jogadores).filter(j => !j.ehBot);
        if(humanos.length === 0) { jogoAndando = false; jogadores = {}; }
        io.emit('atualizarLista', Object.values(jogadores));
        atualizarContadorOnline();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`SERVIDOR APOSTAS: ${PORT}`); });
