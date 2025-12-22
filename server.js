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
let botInterval = null; // O relógio dos bots

// Função para criar as salas
function iniciarSalas(qtd) {
    let conteudos = ['chave'];
    let qtdGas = Math.max(1, Math.floor(qtd * 0.2));
    for(let i=0; i<qtdGas; i++) conteudos.push('gas');
    let qtdVida = Math.max(1, Math.floor(qtd * 0.1));
    for(let i=0; i<qtdVida; i++) conteudos.push('vida');
    while(conteudos.length < qtd) { conteudos.push('vazio'); }
    conteudos.sort(() => Math.random() - 0.5);

    return conteudos.map((tipo, index) => ({
        id: index + 1,
        tipo: tipo,
        ocupante: null,
        bloqueada: false
    }));
}

// Lógica para processar a entrada em uma sala (Humano ou Bot)
function processarEntrada(idSala, idJogador) {
    if(!jogoAndando) return;

    let sala = salasData.find(s => s.id === idSala);
    let jogador = jogadores[idJogador];

    // Verifica se pode entrar
    if(sala && !sala.bloqueada && jogador && jogador.vivo && !jogador.temChave) {
        sala.bloqueada = true;
        sala.ocupante = jogador.nome;
        jogador.sala = idSala;

        // Efeitos
        if(sala.tipo === 'gas') jogador.vidas -= 1;
        if(sala.tipo === 'vida') jogador.vidas += 1;
        if(sala.tipo === 'chave') jogador.temChave = true;

        if(jogador.vidas <= 0) jogador.vivo = false;

        // Avisa todo mundo
        io.emit('salaOcupada', { 
            idSala: idSala, 
            jogador: jogador, 
            efeito: sala.tipo 
        });
    }
}

io.on('connection', (socket) => {
    console.log('Novo jogador:', socket.id);

    // Jogador entra
    socket.on('entrar', (dados) => {
        jogadores[socket.id] = {
            id: socket.id,
            nome: dados.nome,
            tipo: dados.tipo, 
            vidas: 2,
            temChave: false,
            sala: null,
            vivo: true,
            ehBot: false
        };
        io.emit('atualizarLista', Object.values(jogadores));
    });

    // Iniciar Jogo (Com Bots!)
    socket.on('iniciarJogo', () => {
        if(jogoAndando) return; // Já começou

        // 1. Criar Bots até completar 20 jogadores
        let qtdAtual = Object.values(jogadores).length;
        let botsParaCriar = 20 - qtdAtual;

        for(let i = 1; i <= botsParaCriar; i++) {
            let botId = `bot-${Date.now()}-${i}`; // ID único pro bot
            jogadores[botId] = {
                id: botId,
                nome: `Bot ${i}`,
                tipo: 'bot', // Cor cinza/padrão no CSS
                vidas: 2,
                temChave: false,
                sala: null,
                vivo: true,
                ehBot: true
            };
        }

        // 2. Preparar Salas
        let listaCompleta = Object.values(jogadores);
        salasData = iniciarSalas(listaCompleta.length);
        jogoAndando = true;

        // Avisa que começou com a lista nova (incluindo bots)
        io.emit('atualizarLista', listaCompleta);
        io.emit('inicioDePartida', { salas: salasData, jogadores: listaCompleta });

        // 3. Ligar o "Cérebro dos Bots"
        if(botInterval) clearInterval(botInterval);
        
        botInterval = setInterval(() => {
            if(!jogoAndando) return clearInterval(botInterval);

            // Filtra bots vivos que ainda não jogaram na rodada (não têm sala)
            let botsDisponiveis = Object.values(jogadores).filter(j => 
                j.ehBot && j.vivo && !j.temChave && j.sala === null
            );

            if(botsDisponiveis.length > 0) {
                // Escolhe um bot aleatório para jogar agora
                let botDaVez = botsDisponiveis[Math.floor(Math.random() * botsDisponiveis.length)];
                
                // Escolhe uma sala vazia aleatória
                let salasLivres = salasData.filter(s => !s.bloqueada);
                
                if(salasLivres.length > 0) {
                    let salaEscolhida = salasLivres[Math.floor(Math.random() * salasLivres.length)];
                    processarEntrada(salaEscolhida.id, botDaVez.id);
                }
            } else {
                // Se não tem bots pra jogar, checa se o jogo acabou ou algo assim
                // (Aqui simplificado para apenas rodar)
            }
        }, 1500); // Um bot joga a cada 1.5 segundos
    });

    // Humano clica na sala
    socket.on('tentarEntrar', (idSala) => {
        processarEntrada(idSala, socket.id);
    });

    socket.on('disconnect', () => {
        delete jogadores[socket.id];
        // Se não tiver mais humanos, reseta o jogo pra economizar memória
        if(Object.values(jogadores).filter(j => !j.ehBot).length === 0) {
            jogoAndando = false;
            jogadores = {};
            if(botInterval) clearInterval(botInterval);
        } else {
            io.emit('atualizarLista', Object.values(jogadores));
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`SERVIDOR COM BOTS RODANDO NA PORTA: ${PORT}`);
});
