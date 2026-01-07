const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const bancoQuestoes = require('./bancoDeQuestoes'); 

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

let jogadores = {};
let jogoAndamento = false;
let indiceQuestao = 0;
let respostasRodada = 0;
let timer = null;
const TEMPO_PERGUNTA = 25; 

io.on('connection', (socket) => {
    socket.on('entrar', (nome) => {
        jogadores[socket.id] = { id: socket.id, nome: nome, pontos: 0, respondeu: false };
        io.emit('atualizarLista', Object.values(jogadores));
    });

    socket.on('iniciarJogo', () => {
        if (!jogoAndamento && Object.keys(jogadores).length > 0) {
            jogoAndamento = true;
            indiceQuestao = 0;
            zerarPontos();
            enviarQuestao();
        }
    });

    socket.on('responder', (opcao) => {
        if (!jogoAndamento) return;
        const jogador = jogadores[socket.id];
        if (jogador && !jogador.respondeu) {
            jogador.respondeu = true;
            respostasRodada++;
            const qAtual = bancoQuestoes[indiceQuestao];
            if (opcao === qAtual.correta) jogador.pontos += 10;
            io.emit('atualizarStatus', { id: socket.id });
            if (respostasRodada >= Object.keys(jogadores).length) {
                clearTimeout(timer);
                finalizarRodada();
            }
        }
    });

    socket.on('disconnect', () => {
        delete jogadores[socket.id];
        io.emit('atualizarLista', Object.values(jogadores));
        if (Object.keys(jogadores).length === 0) {
            jogoAndamento = false;
            clearTimeout(timer);
        }
    });
});

function zerarPontos() { Object.values(jogadores).forEach(j => { j.pontos = 0; j.respondeu = false; }); io.emit('atualizarLista', Object.values(jogadores)); }

function enviarQuestao() {
    if (indiceQuestao >= bancoQuestoes.length) { fimDeJogo(); return; }
    const q = bancoQuestoes[indiceQuestao];
    respostasRodada = 0;
    Object.values(jogadores).forEach(j => j.respondeu = false);
    io.emit('novaQuestao', { id: q.id, pergunta: q.pergunta, opcoes: q.opcoes, tempo: TEMPO_PERGUNTA, totalQuestoes: bancoQuestoes.length, atual: indiceQuestao + 1 });
    clearInterval(timer);
    let tempo = TEMPO_PERGUNTA;
    timer = setInterval(() => { tempo--; if(tempo <= 0) { clearInterval(timer); finalizarRodada(); } }, 1000);
}

function finalizarRodada() {
    const q = bancoQuestoes[indiceQuestao];
    io.emit('resultadoRodada', { correta: q.correta, explicacao: q.explicacao, placar: Object.values(jogadores) });
    setTimeout(() => { indiceQuestao++; enviarQuestao(); }, 10000);
}

function fimDeJogo() {
    jogoAndamento = false;
    io.emit('fimDeJogo', Object.values(jogadores).sort((a, b) => b.pontos - a.pontos));
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`QUIZ RODANDO NA PORTA: ${PORT}`); });