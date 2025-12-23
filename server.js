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

// Variáveis Votação/Duelo
let votosComputados = {}; 
let jaVotaram = [];
let dueloAtivo = false;
let duelistas = []; // [player1, player2]
let sinalVerde = false; // Controle do minigame

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
    if(!jogoAndando || dueloAtivo) return;
    clearTimeout(timerTurno);

    if(turnoIndex >= ordemTurno.length) {
        // Fim da rodada -> Votação (se tiver gente suficiente)
        let vivos = Object.values(jogadores).filter(j => j.vivo);
        if(vivos.length > 1) {
            iniciarFaseVotacao();
        } else {
            faseExplosao(null); // Só 1 vivo, acaba
        }
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

// 2. FASE DE VOTAÇÃO
function iniciarFaseVotacao() {
    votosComputados = {};
    jaVotaram = [];
    
    io.emit('mensagem', { texto: "🗳️ VOTAÇÃO INICIADA!", cor: "#00b0ff" });
    let candidatos = Object.values(jogadores).filter(j => j.vivo);
    io.emit('abrirVotacao', candidatos);

    // Bots votam
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

    // Ordena por votos (Decrescente)
    let rankingVotos = Object.keys(votosComputados).sort((a,b) => votosComputados[b] - votosComputados[a]);
    
    // Se ninguém recebeu voto (raro), aleatório morre? Não, segue jogo.
    if(rankingVotos.length === 0) {
        io.emit('mensagem', { texto: "NINGUÉM VOTOU? QUE PAZ...", cor: "yellow" });
        iniciarNovaRodada(Object.values(jogadores).filter(j=>j.vivo));
        return;
    }

    // Pega os Top 2 (ou Top 1 se só tiver 1 votado)
    let id1 = rankingVotos[0];
    let id2 = rankingVotos[1];

    if(!id2) {
        // Só um foi votado (unanimidade), ele vai pro duelo sozinho? Não, morre direto.
        faseExplosao(jogadores[id1]);
    } else {
        // TEMOS UM DUELO!
        let p1 = jogadores[id1];
        let p2 = jogadores[id2];
        iniciarDuelo(p1, p2);
    }
}

// 3. O DUELO (MINIGAME)
function iniciarDuelo(p1, p2) {
    if(!p1 || !p2) { faseExplosao(null); return; } // Segurança

    dueloAtivo = true;
    duelistas = [p1, p2];
    sinalVerde = false;

    io.emit('mensagem', { texto: `⚔️ DUELO: ${p1.nome} VS ${p2.nome}`, cor: "#ff00ff" });
    io.emit('iniciarDueloUI', { p1: p1, p2: p2 });

    // Preparar o tiro (Wait random time 2s - 6s)
    let tempoEspera = Math.random() * 4000 + 2000;

    setTimeout(() => {
        if(!dueloAtivo) return; // Alguém já clicou antes
        sinalVerde = true;
        io.emit('sinalDuelo', 'ATIRAR!'); // Manda o verde

        // Lógica dos Bots no Duelo
        duelistas.forEach(d => {
            if(d.ehBot && d.vivo) {
                // Bot reage entre 300ms e 800ms
                setTimeout(() => processarTiroDuelo(d.id), Math.random() * 500 + 300);
            }
        });

    }, tempoEspera);
}

function processarTiroDuelo(idAtirador) {
    if(!dueloAtivo) return; // Já acabou

    let atirador = duelistas.find(d => d.id === idAtirador);
    if(!atirador) return;

    if(!sinalVerde) {
        // QUEIMOU LARGADA (Clicou no vermelho) -> MORRE
        dueloAtivo = false;
        io.emit('resultadoDuelo', { vencedor: null, perdedor: atirador, motivo: "QUEIMOU LARGADA!" });
        setTimeout(() => faseExplosao(atirador), 2000);
    } else {
        // CLICOU CERTO (Primeiro no verde) -> VENCE
        dueloAtivo = false;
        let perdedor = duelistas.find(d => d.id !== idAtirador);
        io.emit('resultadoDuelo', { vencedor: atirador, perdedor: perdedor, motivo: "TIRO CERTEIRO!" });
        setTimeout(() => faseExplosao(perdedor), 2000);
    }
}


// 4. ELIMINAÇÃO FINAL
function faseExplosao(eliminado) {
    dueloAtivo = false;

    if(eliminado) {
        if(eliminado.temEscudo) {
            eliminado.temEscudo = false;
            io.emit('mensagem', { texto: `🛡️ ${eliminado.nome} SOBREVIVEU COM ESCUDO!`, cor: "#ffd700" });
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

    // AÇÃO DO DUELO
    socket.on('cliqueDuelo', () => {
        if(dueloAtivo) processarTiroDuelo(socket.id);
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
server.listen(PORT, () => { console.log(`SERVIDOR DUELO: ${PORT}`); });
