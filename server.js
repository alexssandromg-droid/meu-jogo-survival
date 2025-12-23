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

// Variáveis Votação
let votosComputados = {}; 
let jaVotaram = [];

// Variáveis Memória
let memoryAtivo = false;
let memoryPlayers = []; // [p1, p2]
let memorySeq = [];
let playerProgress = {}; // { id: indice_atual }
let rodadaMemory = 1;

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
    if(!jogoAndando || memoryAtivo) return;
    clearTimeout(timerTurno);

    // Fim da rodada de escolhas -> Votação
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

    // Se tiver empate ou top 2, vai pro Memory Game
    if(id2) {
        // Verifica se houve empate real nos votos
        if(votosComputados[id1] === votosComputados[id2]) {
             iniciarMemoryGame(jogadores[id1], jogadores[id2]);
             return;
        }
    }
    
    // Se não teve empate, o mais votado explode (ou joga memória contra o segundo para tentar se salvar? 
    // Vamos fazer: Top 2 sempre duelam na memória pela vida)
    if(id2) {
        iniciarMemoryGame(jogadores[id1], jogadores[id2]);
    } else {
        faseExplosao(jogadores[id1]);
    }
}

// 3. JOGO DA MEMÓRIA (SIMON SAYS)
function iniciarMemoryGame(p1, p2) {
    if(!p1 || !p2) { faseExplosao(null); return; }

    memoryAtivo = true;
    memoryPlayers = [p1, p2];
    rodadaMemory = 3; // Começa com 3 cores
    
    io.emit('mensagem', { texto: `🧠 MEMÓRIA: ${p1.nome} VS ${p2.nome}`, cor: "#d500f9" });
    io.emit('iniciarMemoryUI', { p1: p1, p2: p2 });

    setTimeout(novaRodadaMemory, 3000);
}

function novaRodadaMemory() {
    if(!memoryAtivo) return;
    
    // Gera sequencia
    memorySeq = [];
    for(let i=0; i<rodadaMemory; i++) {
        memorySeq.push(Math.floor(Math.random() * 4)); // 0, 1, 2, 3 (Cores)
    }

    // Reseta progresso
    playerProgress = {};
    memoryPlayers.forEach(p => playerProgress[p.id] = 0); // Índice que o player tem que acertar

    io.emit('memoryShowSequence', memorySeq);

    // Bots jogam
    memoryPlayers.forEach(p => {
        if(p.ehBot && p.vivo) {
            jogarBotMemory(p);
        }
    });
}

function jogarBotMemory(bot) {
    let delay = 2000 + (rodadaMemory * 500); // Espera mostrar a sequencia
    
    memorySeq.forEach((corCorreta, index) => {
        setTimeout(() => {
            if(!memoryAtivo) return;
            // 10% de chance de errar por clique
            let input = (Math.random() > 0.1) ? corCorreta : Math.floor(Math.random()*4);
            validarInputMemory(bot.id, input);
        }, delay + (index * 800));
    });
}

function validarInputMemory(idJogador, corInput) {
    if(!memoryAtivo) return;
    
    // Verifica se é um dos duelistas
    if(!memoryPlayers.find(p => p.id === idJogador)) return;

    let indiceAtual = playerProgress[idJogador];
    let corCorreta = memorySeq[indiceAtual];

    if(corInput === corCorreta) {
        // Acertou esse passo
        playerProgress[idJogador]++;
        
        // Completou a sequência toda?
        if(playerProgress[idJogador] >= memorySeq.length) {
            // Verifica se o outro também completou ou se ainda está jogando
            let oponente = memoryPlayers.find(p => p.id !== idJogador);
            
            // Se ambos completaram (simultaneo), aumenta nível
            if(playerProgress[oponente.id] >= memorySeq.length) {
                rodadaMemory++;
                io.emit('mensagem', { texto: "AMBOS ACERTARAM! NÍVEL SUBIU!", cor: "cyan" });
                setTimeout(novaRodadaMemory, 2000);
            }
        }
    } else {
        // ERROU! PERDEU!
        let perdedor = jogadores[idJogador];
        let vencedor = memoryPlayers.find(p => p.id !== idJogador);
        
        memoryAtivo = false;
        io.emit('memoryResultado', { vencedor: vencedor, perdedor: perdedor });
        io.emit('mensagem', { texto: `❌ ${perdedor.nome} ERROU A SEQUÊNCIA!`, cor: "red" });
        
        setTimeout(() => faseExplosao(perdedor), 2000);
    }
}

// 4. ELIMINAÇÃO FINAL
function faseExplosao(eliminado) {
    memoryAtivo = false;

    if(eliminado) {
        if(eliminado.temEscudo) {
            eliminado.temEscudo = false;
            io.emit('mensagem', { texto: `🛡️ ${eliminado.nome} TINHA ESCUDO E SOBREVIVEU!`, cor: "#ffd700" });
            io.emit('efeitoDefesa', { idVitima: eliminado.id });
        } else {
            eliminado.vivo = false;
            eliminado.vidas = 0;
            io.emit('mensagem', { texto: `💥 ${eliminado.nome} FOI ELIMINADO!`, cor: "red" });
            io.emit('efeitoKill', { idVitima: eliminado.id });
            if(eliminado.sala) io.emit('efeitoExplosao', { idSala: eliminado.sala, nome: eliminado.nome });
        }
    }

    io.emit('atualizarLista', Object.values(jogadores));

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

    // INPUT DO JOGO DA MEMÓRIA
    socket.on('memoryInput', (corIndex) => {
        if(memoryAtivo) validarInputMemory(socket.id, corIndex);
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
server.listen(PORT, () => { console.log(`SERVIDOR MEMORY: ${PORT}`); });
