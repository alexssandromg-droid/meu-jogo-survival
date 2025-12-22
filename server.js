const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

// Serve o arquivo index.html quando acessarem o site
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// DADOS DO JOGO NO SERVIDOR
let jogadores = {}; // Lista de quem está online
let salasData = []; // Estado das salas
let faseAtual = 1;
let jogoAndando = false;

// Função para iniciar/reiniciar as salas
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

io.on('connection', (socket) => {
    console.log('Jogador conectou:', socket.id);

    // Quando o jogador entra com nome
    socket.on('entrar', (dados) => {
        jogadores[socket.id] = {
            id: socket.id,
            nome: dados.nome,
            tipo: dados.tipo, // p1, p2, p3, p4
            vidas: 2,
            temChave: false,
            sala: null,
            vivo: true
        };
        
        // Se for o primeiro, vira o "dono" e pode iniciar
        io.emit('atualizarLista', Object.values(jogadores));
    });

    // Iniciar Partida
    socket.on('iniciarJogo', () => {
        let lista = Object.values(jogadores);
        if(lista.length < 1) return;
        
        salasData = iniciarSalas(lista.length);
        jogoAndando = true;
        io.emit('inicioDePartida', { salas: salasData, jogadores: lista });
    });

    // Clique na Sala
    socket.on('tentarEntrar', (idSala) => {
        if(!jogoAndando) return;
        
        let sala = salasData.find(s => s.id === idSala);
        let jogador = jogadores[socket.id];

        if(sala && !sala.bloqueada && jogador && jogador.vivo && !jogador.temChave) {
            sala.bloqueada = true;
            sala.ocupante = jogador.nome;
            jogador.sala = idSala;

            // Aplica efeitos
            let efeito = sala.tipo;
            if(efeito === 'gas') jogador.vidas -= 1;
            if(efeito === 'vida') jogador.vidas += 1;
            if(efeito === 'chave') jogador.temChave = true;

            if(jogador.vidas <= 0) jogador.vivo = false;

            // Avisa todo mundo o que aconteceu
            io.emit('salaOcupada', { 
                idSala: idSala, 
                jogador: jogador, 
                efeito: sala.tipo 
            });
        }
    });

    socket.on('disconnect', () => {
        delete jogadores[socket.id];
        io.emit('atualizarLista', Object.values(jogadores));
    });
});

// ALTERAÇÃO IMPORTANTE AQUI EMBAIXO:
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`SERVIDOR RODANDO NA PORTA: ${PORT}`);
});