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
    velocidadeBot: 800, // Um pouco mais humano
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

// NOMES DE BOTS
const botNames = [
    "Viper", "Ghost", "Shadow", "Rex", "Neo", "Cipher", "Blade", "Raven", "Volt", "Titan",
    "Fury", "Ace", "Duke", "Wolf", "Hawk", "Storm", "Nova", "Rogue", "Spike", "Zero",
    "Glitch", "Echo", "Tank", "Joker", "Venom", "Doom", "Crash", "Axel", "Blaze", "Iron"
];

// Votação
let votosComputados = {}; 
let jaVotaram = [];
let apostas = {}; 

// Tabuleiro
let boardAtivo = false;
let boardPlayers = []; // Lista de quem está jogando (2, 3 ou 4)
let boardPositions = {};
let boardTurn = 0; 
let boardWinners = []; // Quem já chegou no fim
let qtdVagasSalvas = 2; // Quantos se salvam
const BOARD_SIZE = 20;

// === AUXILIARES ===
function iniciarSalas(qtdJogadores) {
    let qtdPortas = Math.ceil(qtdJogadores * gameConfig.fatorPortas);
    if(qtdPortas < qtdJogadores) qtdPortas = qtdJogadores;

    let conteudos = [];
    let qtdEscudo = Math.max(2, Math.floor(qtdPortas * 0.20)); 
    let qtdVida = Math.floor(qtdPortas * 0.15);
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

function getUniqueBotName() {
    let usedNames = Object.values(jogadores).map(j => j.nome);
    let available = botNames.filter(n => !usedNames.includes(n));
    if(available.length === 0) return `Bot-${Math.floor(Math.random()*1000)}`;
    return available[Math.floor(Math.random() * available.length)];
}

// === FLUXO DO JOGO ===

function processarProximoTurno() {
    if(!jogoAndando || boardAtivo) return;
    clearTimeout(timerTurno);

    if(turnoIndex >= ordemTurno.length) {
        let vivos = Object.values(jogadores).filter(j => j.vivo);
        
        if(vivos.length <= 2) {
            // RETA FINAL: Vai direto pro duelo mortal
            iniciarBoardGame(vivos, 1); // Apenas 1 sobrevive
        } else {
            // FASE NORMAL: Votação para eliminar
            iniciarFaseVotacao();
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
function iniciarFaseVotacao() {
    votosComputados = {};
    jaVotaram = [];
    
    io.emit('mensagem', { texto: "🗳️ VOTAÇÃO: ESCOLHAM OS 4 PARA O JOGO MORTAL!", cor: "#00b0ff" });
    let candidatos = Object.values(jogadores).filter(j => j.vivo);
    
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
    
    // Ordena por votos
    let ranking = Object.keys(votosComputados).sort((a,b) => votosComputados[b] - votosComputados[a]);
    
    // Se não teve votos suficientes, pega aleatório dos vivos
    if(ranking.length < 4) {
        let vivos = Object.values(jogadores).filter(j => j.vivo).map(j => j.id);
        // Completa o ranking com quem não foi votado mas tá vivo
        vivos.forEach(id => { if(!ranking.includes(id)) ranking.push(id); });
    }

    // Pega os TOP 4 (ou menos se tiver poucos vivos)
    let maxParticipantes = Math.min(ranking.length, 4);
    let idsParticipantes = ranking.slice(0, maxParticipantes);
    
    let participantes = idsParticipantes.map(id => jogadores[id]);

    // Inicia Apostas antes do Tabuleiro
    iniciarFaseApostas(participantes);
}

// 3. FASE DE APOSTAS
function iniciarFaseApostas(participantes) {
    apostas = {};
    io.emit('mensagem', { texto: `💸 QUEM SE SALVA? FAÇAM SUAS APOSTAS!`, cor: "#00e676" });
    
    // Manda lista pro front
    io.emit('abrirApostasUI', participantes);

    // Bots apostam
    Object.values(jogadores).filter(j => j.ehBot && j.vivo && !participantes.includes(j)).forEach(bot => {
        setTimeout(() => {
            let rand = participantes[Math.floor(Math.random() * participantes.length)];
            apostas[bot.id] = rand.id;
        }, 2000);
    });

    setTimeout(() => {
        io.emit('fecharApostasUI');
        iniciarBoardGame(participantes, 2); // 4 jogam, 2 sobrevivem
    }, 8000);
}

// 4. JOGO DO TABULEIRO (4 PLAYERS ou 2 FINALISTAS)
function iniciarBoardGame(participantes, vagas) {
    boardAtivo = true;
    boardPlayers = participantes; // Array de objetos jogadores
    boardPositions = {};
    boardWinners = [];
    qtdVagasSalvas = vagas; // 2 normalmente, 1 na final
    boardTurn = 0; 

    // Inicializa posições
    participantes.forEach(p => boardPositions[p.id] = 0);

    let titulo = (vagas === 1) ? "💀 FINAL MORTAL (SÓ 1 VIVE)" : "🎲 CORRIDA PELA VIDA (2 VAGAS)";
    io.emit('mensagem', { texto: titulo, cor: "#ff9100" });
    
    io.emit('iniciarBoardUI', { 
        players: participantes, 
        tamanho: BOARD_SIZE,
        vagas: vagas
    });

    processarTurnoBoard();
}

function processarTurnoBoard() {
    if(!boardAtivo) return;
    
    // Verifica se jogo acabou
    if(boardWinners.length >= qtdVagasSalvas || boardWinners.length === boardPlayers.length - 1) {
        // Se já temos vencedores suficientes OU só sobrou 1 perdedor
        finalizarBoardGame();
        return;
    }

    let atual = boardPlayers[boardTurn];
    
    // Se o jogador atual já ganhou, pula a vez dele
    if(boardWinners.find(p => p.id === atual.id)) {
        proximoTurnoBoard();
        return;
    }

    io.emit('vezBoard', { id: atual.id, nome: atual.nome });

    if(atual.ehBot && atual.vivo) {
        setTimeout(() => rolarDado(atual.id), 1500);
    }
}

function proximoTurnoBoard() {
    boardTurn++;
    if(boardTurn >= boardPlayers.length) boardTurn = 0;
    setTimeout(processarTurnoBoard, 1000);
}

function rolarDado(idSolicitante) {
    if(!boardAtivo) return;
    let atual = boardPlayers[boardTurn];
    if(atual.id !== idSolicitante) return;

    let dado = Math.floor(Math.random() * 6) + 1;
    let novaPos = boardPositions[atual.id] + dado;
    let msgExtra = "";
    
    // Armadilhas e Boosts
    if(novaPos === 6) { novaPos += 3; msgExtra = " (BOOST!)"; }
    if(novaPos === 11) { novaPos -= 4; msgExtra = " (AZAR!)"; }
    if(novaPos === 16) { novaPos -= 2; msgExtra = " (VOLTOU)"; }

    if(novaPos > BOARD_SIZE) novaPos = BOARD_SIZE;
    boardPositions[atual.id] = novaPos;

    io.emit('dadoRolado', { id: atual.id, dado: dado, pos: novaPos, msg: msgExtra });

    if(novaPos >= BOARD_SIZE) {
        // Chegou no fim!
        boardWinners.push(atual);
        io.emit('mensagem', { texto: `🏁 ${atual.nome} SE SALVOU!`, cor: "#00e676" });
        io.emit('jogadorSalvoBoard', { id: atual.id }); // Efeito visual
        proximoTurnoBoard();
    } else {
        proximoTurnoBoard();
    }
}

// 5. FIM DO JOGO E ELIMINAÇÕES
function finalizarBoardGame() {
    boardAtivo = false;
    
    // Quem não está na lista de vencedores é eliminado
    let perdedores = boardPlayers.filter(p => !boardWinners.find(w => w.id === p.id));
    
    perdedores.forEach(p => {
        // Checa Escudo
        if(p.temEscudo) {
            p.temEscudo = false;
            io.emit('mensagem', { texto: `🛡️ ${p.nome} USOU O ESCUDO E NÃO MORREU!`, cor: "#ffd700" });
            io.emit('efeitoDefesa', { idVitima: p.id });
        } else {
            p.vivo = false; 
            p.vidas = 0;
            io.emit('mensagem', { texto: `💥 ${p.nome} NÃO CORREU O BASTANTE E MORREU!`, cor: "red" });
            io.emit('efeitoKill', { idVitima: p.id });
        }
    });

    // Apostas
    verificarApostas(boardWinners);

    io.emit('atualizarLista', Object.values(jogadores));
    io.emit('fecharBoardUI');

    // Checa campeão geral
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

function verificarApostas(vencedores) {
    let idsVencedores = vencedores.map(v => v.id);
    // Todos que não jogaram o minigame
    let apostadores = Object.values(jogadores).filter(j => j.vivo && !boardPlayers.find(p => p.id === j.id));

    apostadores.forEach(ap => {
        let voto = apostas[ap.id];
        // Se apostou em alguém que NÃO está na lista de vencedores
        if(voto && !idsVencedores.includes(voto)) {
            if(ap.temEscudo) {
                ap.temEscudo = false;
                io.emit('mensagem', { texto: `🛡️ ${ap.nome} ERROU APOSTA MAS TINHA ESCUDO!`, cor: "gold" });
            } else {
                ap.vivo = false; ap.vidas = 0;
                io.emit('mensagem', { texto: `💸 ${ap.nome} PERDEU TUDO NA APOSTA!`, cor: "red" });
                io.emit('efeitoKill', { idVitima: ap.id });
            }
        }
    });
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
    socket.on('adminSalvarConfig', (n) => { /* ... */ });
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
            let nomeBot = getUniqueBotName();
            jogadores[idBot] = {
                id: idBot, nome: nomeBot, tipo: 'bot',
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

    socket.on('jogarTurno', (idSala) => resolverEntrada(idSala, socket.id));
    socket.on('enviarVoto', (idAlvo) => { if(jogadores[socket.id]) registrarVoto(socket.id, idAlvo); });
    socket.on('fazerAposta', (idCandidato) => apostas[socket.id] = idCandidato);
    socket.on('pedirDado', () => { if(boardAtivo) rolarDado(socket.id); });

    socket.on('disconnect', () => {
        if(jogadores[socket.id]) { jogadores[socket.id].vivo = false; delete jogadores[socket.id]; }
        io.emit('atualizarLista', Object.values(jogadores));
        atualizarContadorOnline();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`SERVIDOR SQUID BOARD: ${PORT}`); });
