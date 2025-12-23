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

// Votação e Apostas
let votosComputados = {}; 
let jaVotaram = [];
let apostas = {}; 

// === VARIÁVEIS DOS MINIGAMES ===
let minigameAtivo = false;
let tipoMinigame = null; // 'BOARD', 'MEMORY', 'REFLEX', 'CLICKER', 'MATH'
let duelistas = []; // [p1, p2]

// Estado Específico de cada jogo
let mgState = {}; 

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

// === FLUXO PRINCIPAL ===

function processarProximoTurno() {
    if(!jogoAndando || minigameAtivo) return;
    clearTimeout(timerTurno);

    if(turnoIndex >= ordemTurno.length) {
        let vivos = Object.values(jogadores).filter(j => j.vivo);
        if(vivos.length > 1) iniciarFaseVotacao(null);
        else faseExplosao(null); 
        return;
    }

    let jogadorAtual = ordemTurno[turnoIndex];
    if(!jogadorAtual || !jogadorAtual.vivo) {
        turnoIndex++;
        processarProximoTurno();
        return;
    }

    io.emit('mudancaDeTurno', { idJogador: jogadorAtual.id, nome: jogadorAtual.nome, tempo: 10 });

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

// 2. VOTAÇÃO
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
    if(jaVotaram.length >= totalJogadores) setTimeout(finalizarVotacao, 1000);
}

function finalizarVotacao() {
    io.emit('fecharVotacao');
    let rankingVotos = Object.keys(votosComputados).sort((a,b) => votosComputados[b] - votosComputados[a]);
    if(rankingVotos.length === 0) {
        io.emit('mensagem', { texto: "SEM VOTOS...", cor: "yellow" });
        iniciarNovaRodada(Object.values(jogadores).filter(j=>j.vivo));
        return;
    }
    let id1 = rankingVotos[0];
    let id2 = rankingVotos[1];

    if(id2) {
        // Empate ou Top 2 -> Vai para Apostas depois Minigame
        iniciarFaseApostas(jogadores[id1], jogadores[id2]);
    } else {
        faseExplosao(jogadores[id1]);
    }
}

// 3. APOSTAS
function iniciarFaseApostas(p1, p2) {
    if(!p1 || !p2) { faseExplosao(null); return; }
    apostas = {};
    io.emit('mensagem', { texto: `💸 APOSTAS: QUEM VENCE O DUELO?`, cor: "#00e676" });
    io.emit('abrirApostasUI', { p1: p1, p2: p2 });

    Object.values(jogadores).filter(j => j.ehBot && j.id !== p1.id && j.id !== p2.id && j.vivo).forEach(bot => {
        setTimeout(() => { apostas[bot.id] = (Math.random() > 0.5) ? p1.id : p2.id; }, 2000);
    });

    setTimeout(() => {
        io.emit('fecharApostasUI');
        sortearMinigame(p1, p2); // VAI PRO SORTEIO
    }, 8000);
}

// 4. SORTEIO E INÍCIO DOS MINIGAMES
function sortearMinigame(p1, p2) {
    minigameAtivo = true;
    duelistas = [p1, p2];
    
    // Lista de jogos disponíveis
    const jogos = ['BOARD', 'MEMORY', 'REFLEX', 'CLICKER', 'MATH'];
    tipoMinigame = jogos[Math.floor(Math.random() * jogos.length)];
    
    io.emit('mensagem', { texto: `🎰 SORTEANDO MINIGAME...`, cor: "#ff00ff" });
    
    // Simula roleta visual no cliente
    setTimeout(() => {
        switch(tipoMinigame) {
            case 'BOARD': iniciarBoardGame(); break;
            case 'MEMORY': iniciarMemoryGame(); break;
            case 'REFLEX': iniciarReflexGame(); break;
            case 'CLICKER': iniciarClickerGame(); break;
            case 'MATH': iniciarMathGame(); break;
        }
    }, 2000);
}

// --- LOGICA DOS 5 JOGOS ---

// JOGO 1: TABULEIRO (Sorte)
function iniciarBoardGame() {
    mgState = { pos: {}, turn: 0 };
    mgState.pos[duelistas[0].id] = 0;
    mgState.pos[duelistas[1].id] = 0;
    
    io.emit('iniciarMinigameUI', { type: 'BOARD', p1: duelistas[0], p2: duelistas[1] });
    setTimeout(turnoBoard, 1000);
}
function turnoBoard() {
    if(!minigameAtivo) return;
    let atual = duelistas[mgState.turn];
    io.emit('boardVez', { id: atual.id });
    if(atual.ehBot && atual.vivo) setTimeout(() => inputBoard(atual.id), 1000);
}
function inputBoard(id) {
    if(!minigameAtivo || duelistas[mgState.turn].id !== id) return;
    
    let dado = Math.floor(Math.random() * 6) + 1;
    let novaPos = mgState.pos[id] + dado;
    if(novaPos === 7) novaPos += 2; // Sorte
    if(novaPos === 13) novaPos -= 3; // Azar
    if(novaPos > 20) novaPos = 20;
    mgState.pos[id] = novaPos;

    io.emit('boardDado', { id: id, val: dado, pos: novaPos });

    if(novaPos >= 20) encerrarMinigame(jogadores[id]); // Vencedor
    else {
        mgState.turn = (mgState.turn === 0) ? 1 : 0;
        setTimeout(turnoBoard, 1000);
    }
}

// JOGO 2: MEMÓRIA (Memória)
function iniciarMemoryGame() {
    mgState = { seq: [], prog: {}, nivel: 3 };
    duelistas.forEach(p => mgState.prog[p.id] = 0);
    io.emit('iniciarMinigameUI', { type: 'MEMORY', p1: duelistas[0], p2: duelistas[1] });
    setTimeout(novaRodadaMemory, 2000);
}
function novaRodadaMemory() {
    if(!minigameAtivo) return;
    mgState.seq = [];
    for(let i=0; i<mgState.nivel; i++) mgState.seq.push(Math.floor(Math.random() * 4));
    duelistas.forEach(p => mgState.prog[p.id] = 0);
    
    io.emit('memoryShow', mgState.seq);
    
    // Bots
    duelistas.forEach(p => {
        if(p.ehBot) {
            let delay = 2000 + (mgState.nivel * 500);
            mgState.seq.forEach((cor, idx) => {
                setTimeout(() => {
                    let input = (Math.random() > 0.1) ? cor : Math.floor(Math.random()*4); // 10% erro
                    inputMemory(p.id, input);
                }, delay + (idx * 800));
            });
        }
    });
}
function inputMemory(id, cor) {
    if(!minigameAtivo) return;
    let idx = mgState.prog[id];
    if(cor === mgState.seq[idx]) {
        mgState.prog[id]++;
        if(mgState.prog[id] >= mgState.seq.length) {
            // Completou rodada
            let outro = duelistas.find(p => p.id !== id);
            if(mgState.prog[outro.id] >= mgState.seq.length) {
                mgState.nivel++;
                io.emit('mensagem', {texto: "NÍVEL SUBIU!", cor: "cyan"});
                setTimeout(novaRodadaMemory, 1500);
            }
        }
    } else {
        // Errou = Perdeu
        let perdedor = jogadores[id];
        let vencedor = duelistas.find(p => p.id !== id);
        encerrarMinigame(vencedor);
    }
}

// JOGO 3: REFLEXO (Velocidade)
function iniciarReflexGame() {
    io.emit('iniciarMinigameUI', { type: 'REFLEX', p1: duelistas[0], p2: duelistas[1] });
    mgState = { verde: false };
    
    let tempo = Math.random() * 3000 + 2000;
    setTimeout(() => {
        if(!minigameAtivo) return;
        mgState.verde = true;
        io.emit('reflexGo');
        
        duelistas.forEach(p => {
            if(p.ehBot) setTimeout(() => inputReflex(p.id), Math.random() * 400 + 200);
        });
    }, tempo);
}
function inputReflex(id) {
    if(!minigameAtivo) return;
    if(!mgState.verde) {
        // Queimou largada
        let perdedor = jogadores[id];
        let vencedor = duelistas.find(p => p.id !== id);
        encerrarMinigame(vencedor);
    } else {
        // Venceu
        encerrarMinigame(jogadores[id]);
    }
}

// JOGO 4: CLICKER (Esmaga Botão)
function iniciarClickerGame() {
    mgState = { clicks: {}, meta: 20 };
    duelistas.forEach(p => mgState.clicks[p.id] = 0);
    io.emit('iniciarMinigameUI', { type: 'CLICKER', p1: duelistas[0], p2: duelistas[1], meta: 20 });
    
    // Bots clicam
    duelistas.forEach(p => {
        if(p.ehBot) {
            let intv = setInterval(() => {
                if(!minigameAtivo) clearInterval(intv);
                inputClicker(p.id);
            }, 150); // Clica rapido
        }
    });
}
function inputClicker(id) {
    if(!minigameAtivo) return;
    mgState.clicks[id]++;
    io.emit('clickerUpdate', { id: id, val: mgState.clicks[id] });
    if(mgState.clicks[id] >= mgState.meta) {
        encerrarMinigame(jogadores[id]);
    }
}

// JOGO 5: MATEMÁTICA (Raciocínio)
function iniciarMathGame() {
    let n1 = Math.floor(Math.random() * 20) + 1;
    let n2 = Math.floor(Math.random() * 20) + 1;
    mgState = { res: n1 + n2 };
    
    io.emit('iniciarMinigameUI', { type: 'MATH', p1: duelistas[0], p2: duelistas[1], q: `${n1} + ${n2}` });
    
    // Bots
    duelistas.forEach(p => {
        if(p.ehBot) {
            setTimeout(() => {
                // Bot as vezes erra ou acerta
                let resp = (Math.random() > 0.2) ? mgState.res : mgState.res + 1;
                inputMath(p.id, resp);
            }, Math.random() * 2000 + 1000);
        }
    });
}
function inputMath(id, val) {
    if(!minigameAtivo) return;
    if(parseInt(val) === mgState.res) {
        encerrarMinigame(jogadores[id]);
    } else {
        // Errou, perdeu
        let perdedor = jogadores[id];
        let vencedor = duelistas.find(p => p.id !== id);
        encerrarMinigame(vencedor);
    }
}

// 5. RESULTADO FINAL
function encerrarMinigame(vencedor) {
    if(!minigameAtivo) return;
    minigameAtivo = false;
    let perdedor = duelistas.find(p => p.id !== vencedor.id);
    
    io.emit('mensagem', { texto: `🏆 ${vencedor.nome} VENCEU O DUELO!`, cor: "#00e676" });
    
    setTimeout(() => {
        resolverResultadoFinal(vencedor, perdedor);
    }, 2000);
}

function resolverResultadoFinal(vencedor, perdedor) {
    // Mata perdedor
    perdedor.vivo = false; perdedor.vidas = 0;
    io.emit('efeitoKill', { idVitima: perdedor.id });
    io.emit('mensagem', { texto: `💥 ${perdedor.nome} FOI ELIMINADO!`, cor: "red" });

    // Verifica apostas
    let apostadores = Object.values(jogadores).filter(j => j.vivo && j.id !== vencedor.id && j.id !== perdedor.id);
    apostadores.forEach(p => {
        if(apostas[p.id] !== vencedor.id) {
            if(p.temEscudo) {
                p.temEscudo = false;
                io.emit('mensagem', { texto: `🛡️ ${p.nome} ERROU APOSTA MAS TINHA ESCUDO!`, cor: "gold" });
            } else {
                p.vivo = false; p.vidas = 0;
                io.emit('efeitoKill', { idVitima: p.id });
                io.emit('mensagem', { texto: `💸 ${p.nome} ERROU APOSTA E MORREU!`, cor: "red" });
            }
        }
    });

    io.emit('atualizarLista', Object.values(jogadores));
    io.emit('fimMinigameUI'); // Fecha janelas

    let vivos = Object.values(jogadores).filter(j => j.vivo);
    setTimeout(() => {
        if(vivos.length <= 1) {
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
    // Caso de eliminação direta (raro)
    if(eliminado) {
        eliminado.vivo = false;
        io.emit('mensagem', { texto: `💥 ${eliminado.nome} SAIU!`, cor: "red" });
    }
    let vivos = Object.values(jogadores).filter(j => j.vivo);
    if(vivos.length<=1) io.emit('fimDeJogo', {campeao: vivos[0]});
    else iniciarNovaRodada(vivos);
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

// === CONEXÃO PADRÃO ===
io.on('connection', (socket) => {
    atualizarContadorOnline();
    socket.emit('atualizarRanking', hallDaFama);
    socket.on('adminLogin', (s) => socket.emit('adminLogado', s === 'admin'));
    socket.on('adminSalvarConfig', (n) => { /* Simplificado */ });
    socket.on('adminZerarRank', () => { hallDaFama = []; io.emit('atualizarRanking', hallDaFama); });

    socket.on('entrar', (d) => {
        jogadores[socket.id] = { id: socket.id, nome: d.nome, tipo: d.tipo, vidas: 2, temEscudo: false, sala: null, vivo: true, ehBot: false };
        io.emit('atualizarLista', Object.values(jogadores));
    });

    socket.on('iniciarJogo', () => {
        if(jogoAndando) return;
        let qtd = 20 - Object.values(jogadores).length;
        for(let i=1; i<=qtd; i++) {
            let id = `bot-${Date.now()}-${i}`;
            jogadores[id] = { id: id, nome: `Bot ${i}`, tipo: 'bot', vidas: 2, temEscudo: false, sala: null, vivo: true, ehBot: true };
        }
        let vivos = Object.values(jogadores);
        salasData = iniciarSalas(vivos.length);
        ordemTurno = vivos.sort(() => Math.random() - 0.5);
        turnoIndex = 0;
        jogoAndando = true; faseAtual = 1;
        io.emit('inicioDePartida', { salas: salasData, jogadores: vivos });
        setTimeout(processarProximoTurno, 1000);
    });

    socket.on('jogarTurno', (id) => resolverEntrada(id, socket.id));
    socket.on('enviarVoto', (id) => { if(jogadores[socket.id]) registrarVoto(socket.id, id); });
    socket.on('fazerAposta', (id) => apostas[socket.id] = id);

    // INPUTS MINIGAMES
    socket.on('pedirDado', () => { if(minigameAtivo && tipoMinigame==='BOARD') inputBoard(socket.id); });
    socket.on('memoryInput', (c) => { if(minigameAtivo && tipoMinigame==='MEMORY') inputMemory(socket.id, c); });
    socket.on('cliqueReflex', () => { if(minigameAtivo && tipoMinigame==='REFLEX') inputReflex(socket.id); });
    socket.on('clickerHit', () => { if(minigameAtivo && tipoMinigame==='CLICKER') inputClicker(socket.id); });
    socket.on('mathResp', (v) => { if(minigameAtivo && tipoMinigame==='MATH') inputMath(socket.id, v); });

    socket.on('disconnect', () => {
        if(jogadores[socket.id]) { jogadores[socket.id].vivo = false; delete jogadores[socket.id]; }
        io.emit('atualizarLista', Object.values(jogadores));
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`SERVIDOR 5 MINIGAMES: ${PORT}`); });
