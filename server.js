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

// Função Auxiliar: Cria as salas
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

// === LÓGICA DE TURNOS ===

function processarProximoTurno() {
    if(!jogoAndando) return;
    clearTimeout(timerTurno);

    // Verifica se acabaram os turnos (Fim da Rodada -> Explosão)
    if(turnoIndex >= ordemTurno.length) {
        io.emit('mensagem', { texto: "⚠️ ASSASSINO MIRANDO...", cor: "orange" });
        setTimeout(faseExplosao, 2000);
        return;
    }

    let jogadorAtual = ordemTurno[turnoIndex];
    
    // Se o jogador morreu ou desconectou, pula
    if(!jogadorAtual || !jogadorAtual.vivo) {
        turnoIndex++;
        processarProximoTurno();
        return;
    }

    // Avisa todos de quem é a vez
    io.emit('mudancaDeTurno', { 
        idJogador: jogadorAtual.id, 
        nome: jogadorAtual.nome,
        tempo: 10
    });

    if(jogadorAtual.ehBot) {
        // Lógica do Bot: Espera um pouco e joga
        timerTurno = setTimeout(() => {
            jogadaDoBot(jogadorAtual);
        }, 1500); // Bot demora 1.5s para "pensar"
    } else {
        // Lógica do Humano: Espera 10s, se não jogar, joga automático
        timerTurno = setTimeout(() => {
            io.emit('mensagem', { texto: `${jogadorAtual.nome} DEMOROU!`, cor: "red" });
            jogadaDoBot(jogadorAtual); // Auto-escolha
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
        // Sem salas? Pula
        turnoIndex++;
        processarProximoTurno();
    }
}

function resolverEntrada(idSala, idJogador) {
    if(!jogoAndando) return;
    
    let sala = salasData.find(s => s.id === idSala);
    let jogador = jogadores[idJogador] || ordemTurno.find(j => j.id === idJogador);

    // Validação
    if(sala && !sala.bloqueada && jogador && jogador.vivo) {
        // Para o timer (pois jogou)
        clearTimeout(timerTurno);

        sala.bloqueada = true;
        sala.ocupante = jogador.nome;
        jogador.sala = idSala;

        // Efeitos
        if(sala.tipo === 'gas') jogador.vidas -= 1;
        if(sala.tipo === 'vida') jogador.vidas += 1;
        if(sala.tipo === 'chave') jogador.temChave = true;

        if(jogador.vidas <= 0) jogador.vivo = false;

        // Atualiza Front
        io.emit('salaOcupada', { idSala: idSala, jogador: jogador, efeito: sala.tipo });
        io.emit('atualizarLista', Object.values(jogadores));

        // Segue o jogo
        turnoIndex++;
        setTimeout(processarProximoTurno, 1000); // Pequena pausa pra ver o efeito
    }
}

function faseExplosao() {
    if(!jogoAndando) return;

    // Acha quem pode explodir (na sala, vivo, sem chave)
    let alvos = ordemTurno.filter(j => j.vivo && j.sala && !j.temChave);
    
    if(alvos.length > 0) {
        let vitima = alvos[Math.floor(Math.random() * alvos.length)];
        vitima.vivo = false;
        vitima.vidas = 0;
        
        io.emit('efeitoExplosao', { 
            idSala: vitima.sala, 
            nome: vitima.nome 
        });
        io.emit('mensagem', { texto: `💥 ${vitima.nome} ELIMINADO!`, cor: "red" });
    } else {
        io.emit('mensagem', { texto: "ASSASSINO NÃO ACHOU NINGUÉM!", cor: "yellow" });
    }

    io.emit('atualizarLista', Object.values(jogadores));

    // Verifica Vencedor ou Próxima Fase
    let vivos = Object.values(jogadores).filter(j => j.vivo);
    
    setTimeout(() => {
        if(vivos.length <= 1) {
            jogoAndando = false;
            let campeao = vivos[0] ? vivos[0] : { nome: "NINGUÉM", tipo: "bot" };
            io.emit('fimDeJogo', campeao);
        } else {
            // Nova Rodada/Fase
            iniciarNovaRodada(vivos);
        }
    }, 3000);
}

function iniciarNovaRodada(sobreviventes) {
    faseAtual++;
    // Reseta status para nova rodada (mantem vidas? no seu original resetava vidas pra 2)
    sobreviventes.forEach(j => {
        j.vidas = 2;
        j.temChave = false;
        j.sala = null;
    });
    
    // Atualiza lista global
    jogadores = {};
    sobreviventes.forEach(j => jogadores[j.id] = j);
    
    let lista = Object.values(jogadores);
    salasData = iniciarSalas(lista.length);
    ordemTurno = lista.sort(() => Math.random() - 0.5);
    turnoIndex = 0;

    io.emit('novaRodada', { 
        fase: faseAtual, 
        salas: salasData, 
        jogadores: lista 
    });
    
    setTimeout(processarProximoTurno, 1000);
}

// === CONEXÃO ===

io.on('connection', (socket) => {
    console.log('Conectou:', socket.id);

    socket.on('entrar', (dados) => {
        jogadores[socket.id] = {
            id: socket.id,
            nome: dados.nome,
            tipo: dados.tipo,
            vidas: 2, temChave: false, sala: null, vivo: true, ehBot: false
        };
        io.emit('atualizarLista', Object.values(jogadores));
    });

    socket.on('iniciarJogo', () => {
        if(jogoAndando) return;

        // Preencher com Bots
        let lista = Object.values(jogadores);
        let qtdFaltante = 20 - lista.length;
        for(let i=1; i<=qtdFaltante; i++) {
            let idBot = `bot-${Date.now()}-${i}`;
            jogadores[idBot] = {
                id: idBot, nome: `Bot ${i}`, tipo: 'bot',
                vidas: 2, temChave: false, sala: null, vivo: true, ehBot: true
            };
        }

        // Setup Inicial
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
        // Verifica se é a vez desse socket
        let jogadorDaVez = ordemTurno[turnoIndex];
        if(jogadorDaVez && jogadorDaVez.id === socket.id) {
            resolverEntrada(idSala, socket.id);
        }
    });

    socket.on('disconnect', () => {
        // Se o jogo não começou, remove da lista. Se começou, marca como morto no proximo turno.
        if(jogadores[socket.id]) {
            jogadores[socket.id].vivo = false;
            delete jogadores[socket.id];
        }
        io.emit('atualizarLista', Object.values(jogadores));
        
        // Se ficar vazio, reseta
        let humanos = Object.values(jogadores).filter(j => !j.ehBot);
        if(humanos.length === 0) {
            jogoAndando = false;
            jogadores = {};
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`SERVIDOR TURN-BASED NA PORTA: ${PORT}`);
});
