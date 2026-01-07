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

// === ESTADO DO JOGO ===
let jogadores = {};
let jogoAndamento = false;
let indiceQuestao = 0;
let respostasRodada = 0;
let timer = null;
let questoesDaPartida = []; // Lista filtrada para a partida atual
const TEMPO_PADRAO = 30;

io.on('connection', (socket) => {
    
    socket.on('entrar', (nome) => {
        jogadores[socket.id] = {
            id: socket.id,
            nome: nome,
            pontos: 0,
            respondeu: false
        };
        io.emit('atualizarLista', Object.values(jogadores));
    });

    // INICIAR JOGO NORMAL (COM QUANTIDADE PERSONALIZADA)
    socket.on('iniciarJogo', (config) => {
        if (!jogoAndamento && Object.keys(jogadores).length > 0) {
            jogoAndamento = true;
            indiceQuestao = 0;
            zerarPontos();

            // Embaralha e corta a quantidade pedida
            let qtd = config.qtd || 10;
            if (qtd > bancoQuestoes.length) qtd = bancoQuestoes.length;
            
            // Cria cópia embaralhada
            questoesDaPartida = [...bancoQuestoes]
                .sort(() => Math.random() - 0.5)
                .slice(0, qtd);

            enviarQuestao();
        }
    });

    // INICIAR MODO REVISÃO (RECEBE IDs DOS ERROS DO CLIENTE)
    socket.on('iniciarRevisao', (idsErros) => {
        if (!jogoAndamento && idsErros && idsErros.length > 0) {
            jogoAndamento = true;
            indiceQuestao = 0;
            zerarPontos();

            // Filtra apenas as questões que o jogador errou
            questoesDaPartida = bancoQuestoes.filter(q => idsErros.includes(q.id));
            
            // Se por acaso os IDs não baterem, pega 5 aleatórias
            if (questoesDaPartida.length === 0) {
                questoesDaPartida = bancoQuestoes.slice(0, 5);
            }

            enviarQuestao();
        }
    });

    socket.on('responder', (opcao) => {
        if (!jogoAndamento) return;
        const jogador = jogadores[socket.id];
        
        if (jogador && !jogador.respondeu) {
            jogador.respondeu = true;
            respostasRodada++;

            const qAtual = questoesDaPartida[indiceQuestao];
            if (opcao === qAtual.correta) {
                jogador.pontos += 10;
            }

            io.emit('atualizarStatus', { id: socket.id });

            if (respostasRodada >= Object.keys(jogadores).length) {
                clearTimeout(timer);
                finalizarRodada();
            }
        }
    });

    socket.on('pararJogo', () => {
        jogoAndamento = false;
        clearTimeout(timer);
        io.emit('jogoCancelado');
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

function zerarPontos() {
    Object.values(jogadores).forEach(j => { j.pontos = 0; j.respondeu = false; });
    io.emit('atualizarLista', Object.values(jogadores));
}

function enviarQuestao() {
    if (indiceQuestao >= questoesDaPartida.length) {
        fimDeJogo();
        return;
    }

    const q = questoesDaPartida[indiceQuestao];
    const dadosQuestao = {
        id: q.id,
        pergunta: q.pergunta,
        opcoes: q.opcoes,
        tempo: TEMPO_PADRAO,
        totalQuestoes: questoesDaPartida.length,
        atual: indiceQuestao + 1
    };

    respostasRodada = 0;
    Object.values(jogadores).forEach(j => j.respondeu = false);
    
    io.emit('novaQuestao', dadosQuestao);
    
    let tempoRestante = TEMPO_PADRAO;
    clearInterval(timer);
    timer = setInterval(() => {
        tempoRestante--;
        if (tempoRestante <= 0) {
            clearInterval(timer);
            finalizarRodada();
        }
    }, 1000);
}

function finalizarRodada() {
    const q = questoesDaPartida[indiceQuestao];
    
    io.emit('resultadoRodada', {
        idQuestao: q.id, // Envia ID para cliente salvar erro
        correta: q.correta,
        explicacao: q.explicacao,
        placar: Object.values(jogadores)
    });

    setTimeout(() => {
        indiceQuestao++;
        enviarQuestao();
    }, 8000); // 8 segundos para ler
}

function fimDeJogo() {
    jogoAndamento = false;
    let ranking = Object.values(jogadores).sort((a, b) => b.pontos - a.pontos);
    io.emit('fimDeJogo', ranking);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`SERVIDOR ATUALIZADO NA PORTA: ${PORT}`);
});
