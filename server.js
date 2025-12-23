const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// === DADOS DO JOGO ===
let jogadores = {}; 
let salasData = [];
let jogoAndando = false;
let ordemTurno = [];
let turnoIndex = 0;
let timerTurno = null;
let faseAtual = 1;

// RANKING (Memória do Servidor)
let hallDaFama = []; // [{ nome: "Alex", vitorias: 1, data: "..." }]

// === AUXILIARES ===
function iniciarSalas(qtd) {
    let conteudos = ['chave'];
    let qtdGas = Math.max(1, Math.floor(qtd * 0.2));
    for(let i=0; i<qtdGas; i++) conteudos.push('gas');
    let qtdVida = Math.max(1, Math.floor(qtd * 0.1));
    for(let i=0; i<qtdVida; i++) conteudos.push('vida');
    while(conteudos.length < qtd) { conteudos.push('vazio'); }
    conteudos.sort(() => Math.random() - 0.5);

    return conteudos.map((tipo, index) => ({
        id: index + 1, tipo: tipo, ocupante: null, bloqueada: false
    }));
}

function atualizarContadorOnline() {
    let total = io.engine.clientsCount;
    io.emit('jogadoresOnline', total);
}

// === LÓGICA DO JOGO (Turnos) ===
function processarProximoTurno() {
    if(!jogoAndando) return;
    clearTimeout(timerTurno);

    if(turnoIndex >= ordemTurno.length) {
        io.emit('mensagem', { texto: "⚠️ ASSASSINO MIRANDO...", cor: "orange" });
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
        idJogador: jogadorAtual.id, 
        nome: jogadorAtual.nome,
        tempo: 10
    });

    if(jogadorAtual.ehBot) {
        // === MUDANÇA: BOT AGORA É RÁPIDO (500ms) ===
        timerTurno = setTimeout(() => { jogadaDoBot(jogadorAtual); }, 500);
    } else {
        timerTurno = setTimeout(() => {
            io.emit('mensagem', { texto: `${jogadorAtual.nome} DEMOROU!`, cor: "red" });
            jogadaDoBot(jogadorAtual);
        }, 10000);
    }
}

function jogadaDoBot(jogador) {
    if(!jogoAndando) return;
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
        if(sala.tipo === 'chave') jogador.temChave = true;
        if(jogador.vidas <= 0) jogador.vivo = false;

        io.emit('salaOcupada', { idSala: idSala, jogador: jogador, efeito: sala.tipo });
        io.emit('atualizarLista', Object.values(jogadores));

        turnoIndex++;
        // Pausa curta para ver o efeito antes do próximo
        setTimeout(processarProximoTurno, 800);
    }
}

function faseExplosao() {
    if(!jogoAndando) return;
    let alvos = ordemTurno.filter(j => j.vivo && j.sala && !j.temChave);
    
    if(alvos.length > 0) {
        let vitima = alvos[Math.floor(Math.random() * alvos.length)];
        vitima.vivo = false;
        vitima.vidas = 0;
        io.emit('efeitoExplosao', { idSala: vitima.sala, nome: vitima.nome });
        io.emit('mensagem', { texto: `💥 ${vitima.nome} ELIMINADO!`, cor: "red" });
    } else {
        io.emit('mensagem', { texto: "ASSASSINO NÃO ACHOU NINGUÉM!", cor: "yellow" });
    }

    io.emit('atualizarLista', Object.values(jogadores));
    let vivos = Object.values(jogadores).filter(j => j.vivo);
    
    setTimeout(() => {
        if(vivos.length <= 1) {
            jogoAndando = false;
            let campeao = vivos[0] ? vivos[0] : { nome: "NINGUÉM", tipo: "bot" };
            
            // ADICIONAR AO RANKING
            if(campeao.nome !== "NINGUÉM") {
                hallDaFama.unshift({ // Adiciona no topo
                    nome: campeao.nome,
                    data: new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})
                });
                if(hallDaFama.length > 5) hallDaFama.pop(); // Mantém só os top 5 recentes
            }

            io.emit('fimDeJogo', { campeao: campeao, ranking: hallDaFama });
        } else {
            iniciarNovaRodada(vivos);
        }
    }, 3000);
}

function iniciarNovaRodada(sobreviventes) {
    faseAtual++;
    sobreviventes.forEach(j => { j.vidas = 2; j.temChave = false; j.sala = null; });
    
    jogadores = {};
    sobreviventes.forEach(j => jogadores[j.id] = j);
    
    let lista = Object.values(jogadores);
    salasData = iniciarSalas(lista.length);
    ordemTurno = lista.sort(() => Math.random() - 0.5);
    turnoIndex = 0;

    io.emit('novaRodada', { fase: faseAtual, salas: salasData, jogadores: lista });
    setTimeout(processarProximoTurno, 1000);
}

// === CONEXÃO SOCKET ===
io.on('connection', (socket) => {
    atualizarContadorOnline();
    // Envia o Ranking atual logo de cara
    socket.emit('atualizarRanking', hallDaFama);

    socket.on('entrar', (dados) => {
        jogadores[socket.id] = {
            id: socket.id, nome: dados.nome, tipo: dados.tipo,
            vidas: 2, temChave: false, sala: null, vivo: true, ehBot: false
        };
        io.emit('atualizarLista', Object.values(jogadores));
    });

    socket.on('iniciarJogo', () => {
        if(jogoAndando) return;
        let lista = Object.values(jogadores);
        let qtdFaltante = 20 - lista.length;
        for(let i=1; i<=qtdFaltante; i++) {
            let idBot = `bot-${Date.now()}-${i}`;
            jogadores[idBot] = {
                id: idBot, nome: `Bot ${i}`, tipo: 'bot',
                vidas: 2, temChave: false, sala: null, vivo: true, ehBot: true
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
        if(jogadores[socket.id]) {
            jogadores[socket.id].vivo = false;
            delete jogadores[socket.id];
        }
        let humanos = Object.values(jogadores).filter(j => !j.ehBot);
        if(humanos.length === 0) { jogoAndando = false; jogadores = {}; }
        
        io.emit('atualizarLista', Object.values(jogadores));
        atualizarContadorOnline();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`SERVIDOR RODANDO: ${PORT}`); });
