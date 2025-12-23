const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// === CONFIGURAÇÕES GLOBAIS ===
let gameConfig = {
    maxJogadores: 20,
    vidasIniciais: 2,
    velocidadeBot: 500,
    fatorPortas: 1.2,   // 1.2x o numero de jogadores (salas apertadas)
    chanceGas: 0.4,     // 40% das salas tem Gás (MUITO GÁS)
    chanceChave: 0.2    // 20% das salas tem Chave (Várias chaves)
};

// === DADOS DO JOGO ===
let jogadores = {}; 
let salasData = [];
let jogoAndando = false;
let ordemTurno = [];
let turnoIndex = 0;
let timerTurno = null;
let faseAtual = 1;
let hallDaFama = [];

// === GERADOR DE SALAS (AGRESSIVO) ===
function iniciarSalas(qtdJogadores) {
    // Arena encolhe conforme jogadores morrem
    let qtdPortas = Math.ceil(qtdJogadores * gameConfig.fatorPortas);
    if(qtdPortas < qtdJogadores) qtdPortas = qtdJogadores; // Mínimo para caber todo mundo
    
    let conteudos = [];
    
    // Calcula quantidades baseadas nas configs
    let qtdChaves = Math.max(1, Math.floor(qtdPortas * gameConfig.chanceChave));
    let qtdGas = Math.floor(qtdPortas * gameConfig.chanceGas);
    let qtdVida = Math.floor(qtdPortas * 0.1); // 10% vida fixo

    // Adiciona os itens
    for(let i=0; i<qtdChaves; i++) conteudos.push('chave');
    for(let i=0; i<qtdGas; i++) conteudos.push('gas');
    for(let i=0; i<qtdVida; i++) conteudos.push('vida');
    
    // Completa com vazio
    while(conteudos.length < qtdPortas) { conteudos.push('vazio'); }
    
    // Embaralha tudo
    conteudos.sort(() => Math.random() - 0.5);

    return conteudos.map((tipo, index) => ({
        id: index + 1, tipo: tipo, ocupante: null, bloqueada: false
    }));
}

function atualizarContadorOnline() {
    io.emit('jogadoresOnline', io.engine.clientsCount);
}

// === LÓGICA DE TURNOS ===
function processarProximoTurno() {
    if(!jogoAndando) return;
    clearTimeout(timerTurno);

    if(turnoIndex >= ordemTurno.length) {
        io.emit('mensagem', { texto: "⚠️ HORA DO EXPURGO...", cor: "orange" });
        setTimeout(faseExplosao, 2000);
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
    if(!jogoAndando) return;
    let salasLivres = salasData.filter(s => !s.bloqueada);
    if(salasLivres.length > 0) {
        // Bot tenta pegar chaves se "soubesse" (aleatório por enquanto)
        let escolha = salasLivres[Math.floor(Math.random() * salasLivres.length)];
        resolverEntrada(escolha.id, jogador.id);
    } else {
        turnoIndex++;
        processarProximoTurno();
    }
}

function resolverEntrada(idSala, idJogador) {
    if(!jogoAndando) return;
    let sala = salasData.find(s => s.id === idSala);
    let jogador = jogadores[idJogador] || ordemTurno.find(j => j.id === idJogador);

    if(sala && !sala.bloqueada && jogador && jogador.vivo) {
        clearTimeout(timerTurno);
        sala.bloqueada = true;
        sala.ocupante = jogador.nome;
        jogador.sala = idSala;

        if(sala.tipo === 'gas') jogador.vidas -= 1;
        if(sala.tipo === 'vida') jogador.vidas += 1;
        if(sala.tipo === 'chave') jogador.temChave = true; // FICOU IMUNE!

        if(jogador.vidas <= 0) jogador.vivo = false;

        io.emit('salaOcupada', { idSala: idSala, jogador: jogador, efeito: sala.tipo });
        io.emit('atualizarLista', Object.values(jogadores));

        turnoIndex++;
        setTimeout(processarProximoTurno, 600);
    }
}

function faseExplosao() {
    if(!jogoAndando) return;
    
    // QUEM NÃO TEM CHAVE EXPLODE (A menos que já tenha morrido antes)
    let alvos = ordemTurno.filter(j => j.vivo && !j.temChave);
    
    if(alvos.length > 0) {
        alvos.forEach(vitima => {
            vitima.vivo = false;
            vitima.vidas = 0;
            if(vitima.sala) {
                io.emit('efeitoExplosao', { idSala: vitima.sala, nome: vitima.nome });
            }
        });
        io.emit('mensagem', { texto: `💥 SEM CHAVE = ELIMINADO!`, cor: "red" });
    } else {
        io.emit('mensagem', { texto: "TODOS ENCONTRARAM CHAVES!", cor: "#00e676" });
    }

    io.emit('atualizarLista', Object.values(jogadores));
    
    // Quem sobrou vai pro próximo nível
    let vivos = Object.values(jogadores).filter(j => j.vivo);
    
    setTimeout(() => {
        if(vivos.length <= 1) {
            jogoAndando = false;
            let campeao = vivos[0] ? vivos[0] : { nome: "NINGUÉM", tipo: "bot" };
            
            if(campeao.nome !== "NINGUÉM") {
                hallDaFama.unshift({ 
                    nome: campeao.nome, 
                    data: new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})
                });
                if(hallDaFama.length > 10) hallDaFama.pop();
            }
            io.emit('fimDeJogo', { campeao: campeao });
            io.emit('atualizarRanking', hallDaFama);
        } else {
            iniciarNovaRodada(vivos);
        }
    }, 3000);
}

function iniciarNovaRodada(sobreviventes) {
    faseAtual++;
    
    // Reseta status para o próximo nível
    sobreviventes.forEach(j => { 
        j.vidas = gameConfig.vidasIniciais; // Recupera vida (prêmio por passar de fase)
        j.temChave = false; // Perde a chave usada
        j.sala = null; 
    });
    
    // Limpa mortos da memória ativa
    jogadores = {};
    sobreviventes.forEach(j => jogadores[j.id] = j);
    
    // Gera arena MENOR (baseada só nos sobreviventes)
    let lista = Object.values(jogadores);
    salasData = iniciarSalas(lista.length);
    ordemTurno = lista.sort(() => Math.random() - 0.5);
    turnoIndex = 0;

    io.emit('novaRodada', { fase: faseAtual, salas: salasData, jogadores: lista });
    setTimeout(processarProximoTurno, 1000);
}

// === CONEXÃO ===
io.on('connection', (socket) => {
    atualizarContadorOnline();
    socket.emit('atualizarRanking', hallDaFama);
    socket.emit('configAtual', gameConfig);

    socket.on('adminLogin', (s) => socket.emit('adminLogado', s === 'admin'));

    socket.on('adminSalvarConfig', (nova) => {
        if(nova.maxJogadores) gameConfig.maxJogadores = parseInt(nova.maxJogadores);
        if(nova.vidasIniciais) gameConfig.vidasIniciais = parseInt(nova.vidasIniciais);
        if(nova.velocidadeBot) gameConfig.velocidadeBot = parseInt(nova.velocidadeBot);
        if(nova.fatorPortas) gameConfig.fatorPortas = parseFloat(nova.fatorPortas);
        if(nova.chanceGas) gameConfig.chanceGas = parseFloat(nova.chanceGas);
        if(nova.chanceChave) gameConfig.chanceChave = parseFloat(nova.chanceChave);
        
        io.emit('mensagem', { texto: "⚙️ REGRAS ATUALIZADAS!", cor: "#00e676" });
    });

    socket.on('adminZerarRank', () => { hallDaFama = []; io.emit('atualizarRanking', hallDaFama); });

    socket.on('entrar', (dados) => {
        jogadores[socket.id] = {
            id: socket.id, nome: dados.nome, tipo: dados.tipo,
            vidas: gameConfig.vidasIniciais, temChave: false, sala: null, vivo: true, ehBot: false
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
                vidas: gameConfig.vidasIniciais, temChave: false, sala: null, vivo: true, ehBot: true
            };
        }
        let listaCompleta = Object.values(jogadores);
        salasData = iniciarSalas(listaCompleta.length);
        ordemTurno = listaCompleta.sort(() => Math.random() - 0.5);
        turnoIndex = 0;
        jogoAndando = true;
        faseAtual = 1;
        io.emit('inicioDePartida', { salas: salasData, jogadores: listaCompleta });
        setTimeout(processarProximoTurno, 1000);
    });

    socket.on('jogarTurno', (idSala) => {
        let jogadorDaVez = ordemTurno[turnoIndex];
        if(jogadorDaVez && jogadorDaVez.id === socket.id) {
            resolverEntrada(idSala, socket.id);
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
server.listen(PORT, () => { console.log(`SERVIDOR RODANDO: ${PORT}`); });
