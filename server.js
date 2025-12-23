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

// Variáveis da Votação
let votosComputados = {}; // { idAlvo: numeroDeVotos }
let jaVotaram = [];
let listaEmpatados = null; // Se houver empate, guarda quem são

// === AUXILIARES ===
function iniciarSalas(qtdJogadores) {
    let qtdPortas = Math.ceil(qtdJogadores * gameConfig.fatorPortas);
    if(qtdPortas < qtdJogadores) qtdPortas = qtdJogadores;

    let conteudos = [];
    
    // Distribuição focada em ESCUDOS
    let qtdEscudo = Math.max(2, Math.floor(qtdPortas * 0.20)); // 20% Escudos (MUITO IMPORTANTE)
    let qtdVida = Math.floor(qtdPortas * 0.10);
    let qtdGas = Math.floor(qtdPortas * 0.10); // Menos gás, o perigo é o voto

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

// 1. RODADA DE ESCOLHA DE SALAS
function processarProximoTurno() {
    if(!jogoAndando) return;
    clearTimeout(timerTurno);

    // Se todos jogaram, INICIA VOTAÇÃO
    if(turnoIndex >= ordemTurno.length) {
        iniciarFaseVotacao(null); // null = votação geral (sem empate previo)
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

        // Efeitos imediatos (Coleta)
        if(sala.tipo === 'gas') {
            jogador.vidas -= 1; // Gás ainda machuca
        }
        else if(sala.tipo === 'vida') {
            jogador.vidas += 1;
        }
        else if(sala.tipo === 'escudo') {
            jogador.temEscudo = true; // Proteção contra votos!
        }

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
    listaEmpatados = empatados;

    let candidatos = [];
    
    if(empatados) {
        io.emit('mensagem', { texto: "⚠️ EMPATE! NOVA VOTAÇÃO DE DESEMPATE!", cor: "orange" });
        candidatos = empatados;
    } else {
        io.emit('mensagem', { texto: "🗳️ HORA DA VOTAÇÃO! ESCOLHAM QUEM ELIMINAR.", cor: "#00b0ff" });
        candidatos = Object.values(jogadores).filter(j => j.vivo);
    }

    // Manda cliente abrir o modal de votação
    io.emit('abrirVotacao', candidatos);

    // Bots votam automaticamente
    Object.values(jogadores).filter(j => j.ehBot).forEach(bot => {
        setTimeout(() => {
            // Bot vota em um candidato aleatório
            let alvo = candidatos[Math.floor(Math.random() * candidatos.length)];
            registrarVoto(bot.id, alvo.id);
        }, Math.random() * 2000 + 500);
    });
}

function registrarVoto(idEleitor, idAlvo) {
    if(jaVotaram.includes(idEleitor)) return;
    
    // Contabiliza
    if(!votosComputados[idAlvo]) votosComputados[idAlvo] = 0;
    votosComputados[idAlvo]++;
    jaVotaram.push(idEleitor);

    // Checa se todos votaram (Vivos + Mortos)
    let totalJogadores = Object.keys(jogadores).length;
    
    // Atualiza progresso (sem revelar quem votou em quem)
    io.emit('progressoVotacao', { atual: jaVotaram.length, total: totalJogadores });

    if(jaVotaram.length >= totalJogadores) {
        setTimeout(finalizarVotacao, 1000);
    }
}

function finalizarVotacao() {
    // Acha o mais votado
    let maxVotos = -1;
    let alvosMaisVotados = [];

    for(let id in votosComputados) {
        let qtd = votosComputados[id];
        if(qtd > maxVotos) {
            maxVotos = qtd;
            alvosMaisVotados = [id];
        } else if (qtd === maxVotos) {
            alvosMaisVotados.push(id);
        }
    }

    // Verifica Empate
    if(alvosMaisVotados.length > 1) {
        // Pega os objetos dos jogadores empatados
        let objsEmpatados = alvosMaisVotados.map(id => jogadores[id]);
        setTimeout(() => iniciarFaseVotacao(objsEmpatados), 2000);
        return;
    }

    // Temos um eliminado
    let idEliminado = alvosMaisVotados[0];
    let eliminado = jogadores[idEliminado];

    // Verifica Escudo
    if(eliminado.temEscudo) {
        eliminado.temEscudo = false; // Quebra o escudo
        io.emit('mensagem', { texto: `🛡️ ${eliminado.nome} TINHA ESCUDO E SOBREVIVEU AOS VOTOS!`, cor: "#ffd700" });
        io.emit('efeitoDefesa', { idVitima: eliminado.id });
    } else {
        eliminado.vivo = false;
        eliminado.vidas = 0;
        io.emit('mensagem', { texto: `💣 ${eliminado.nome} FOI ELIMINADO PELA VOTAÇÃO! (${maxVotos} VOTOS)`, cor: "red" });
        io.emit('efeitoKill', { idVitima: eliminado.id });
        if(eliminado.sala) io.emit('efeitoExplosao', { idSala: eliminado.sala, nome: eliminado.nome });
    }

    io.emit('fecharVotacao');
    io.emit('atualizarLista', Object.values(jogadores));

    // Verifica Vencedor
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
    sobreviventes.forEach(j => { 
        j.sala = null;
        // Escudo se mantém? Vamos dizer que quebra ao mudar de nível pra ficar difícil
        j.temEscudo = false; 
    });
    
    // Jogadores mortos continuam na lista "jogadores" para poderem votar
    // Mas para a ordem de turno, só os vivos
    
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

    // Admin
    socket.on('adminLogin', (s) => socket.emit('adminLogado', s === 'admin'));
    socket.on('adminSalvarConfig', (n) => {
        if(n.maxJogadores) gameConfig.maxJogadores = parseInt(n.maxJogadores);
        if(n.vidasIniciais) gameConfig.vidasIniciais = parseInt(n.vidasIniciais);
        if(n.velocidadeBot) gameConfig.velocidadeBot = parseInt(n.velocidadeBot);
        if(n.fatorPortas) gameConfig.fatorPortas = parseFloat(n.fatorPortas);
        io.emit('mensagem', { texto: "⚙️ REGRAS ATUALIZADAS!", cor: "#00e676" });
    });
    socket.on('adminZerarRank', () => { hallDaFama = []; io.emit('atualizarRanking', hallDaFama); });

    // Jogo
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

    // RECEBE O VOTO
    socket.on('enviarVoto', (idAlvo) => {
        // Qualquer um pode votar (vivo ou morto), desde que esteja no jogo
        if(jogadores[socket.id]) {
            registrarVoto(socket.id, idAlvo);
        }
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
server.listen(PORT, () => { console.log(`SERVIDOR VOTAÇÃO: ${PORT}`); });
