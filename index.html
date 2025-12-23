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
    fatorPortas: 1.2
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

// === GERADOR DE SALAS COM NOVAS DINÂMICAS ===
function iniciarSalas(qtdJogadores) {
    let qtdPortas = Math.ceil(qtdJogadores * gameConfig.fatorPortas);
    if(qtdPortas < qtdJogadores) qtdPortas = qtdJogadores;

    let conteudos = ['chave']; 
    
    // Distribuição (Balanceada para o Caos)
    let qtdGas = Math.floor(qtdPortas * 0.20);      // 20% Gás
    let qtdVida = Math.floor(qtdPortas * 0.10);     // 10% Vida
    let qtdVampiro = Math.floor(qtdPortas * 0.05);  // 5% Vampiro
    let qtdTroca = Math.floor(qtdPortas * 0.05);    // 5% Troca
    let qtdMina = Math.floor(qtdPortas * 0.05);     // 5% Mina
    let qtdEspiao = Math.floor(qtdPortas * 0.05);   // 5% Espião

    for(let i=0; i<qtdGas; i++) conteudos.push('gas');
    for(let i=0; i<qtdVida; i++) conteudos.push('vida');
    for(let i=0; i<qtdVampiro; i++) conteudos.push('vampiro');
    for(let i=0; i<qtdTroca; i++) conteudos.push('troca');
    for(let i=0; i<qtdMina; i++) conteudos.push('mina');
    for(let i=0; i<qtdEspiao; i++) conteudos.push('espiao');
    
    while(conteudos.length < qtdPortas) { conteudos.push('vazio'); }
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
        io.emit('mensagem', { texto: "⚠️ ASSASSINO CHEGANDO...", cor: "orange" });
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
            io.emit('mensagem', { texto: `${jogadorAtual.nome} VACILOU!`, cor: "red" });
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
        let msgExtra = "";

        // === EFEITOS ESPECIAIS ===
        if(sala.tipo === 'gas') {
            jogador.vidas -= 1;
        }
        else if(sala.tipo === 'vida') {
            jogador.vidas += 1;
        }
        else if(sala.tipo === 'chave') {
            jogador.temChave = true;
        }
        else if(sala.tipo === 'vampiro') {
            // Rouba 1 vida de alguém vivo
            let vitimas = ordemTurno.filter(j => j.vivo && j.id !== jogador.id && j.vidas > 0);
            if(vitimas.length > 0) {
                let alvo = vitimas[Math.floor(Math.random() * vitimas.length)];
                alvo.vidas -= 1;
                jogador.vidas += 1;
                if(alvo.vidas <= 0) alvo.vivo = false;
                msgExtra = ` (ROUBOU DE ${alvo.nome}!)`;
            } else {
                msgExtra = " (SEM VÍTIMAS!)";
            }
        }
        else if(sala.tipo === 'troca') {
            // Troca vidas
            let alvos = ordemTurno.filter(j => j.vivo && j.id !== jogador.id);
            if(alvos.length > 0) {
                let alvo = alvos[Math.floor(Math.random() * alvos.length)];
                let vidaMinha = jogador.vidas;
                let vidaDele = alvo.vidas;
                jogador.vidas = vidaDele;
                alvo.vidas = vidaMinha;
                msgExtra = ` (TROCOU COM ${alvo.nome}!)`;
            }
        }
        else if(sala.tipo === 'mina') {
            // Transforma uma sala vazia em Gás
            let salasVazias = salasData.filter(s => s.tipo === 'vazio' && !s.bloqueada);
            if(salasVazias.length > 0) {
                let alvoSala = salasVazias[Math.floor(Math.random() * salasVazias.length)];
                alvoSala.tipo = 'gas'; // Agora é mortal!
                msgExtra = " (UMA SALA VIROU GÁS!)";
            } else {
                msgExtra = " (FALHOU)";
            }
        }
        else if(sala.tipo === 'espiao') {
            // Revela onde tem perigo
            let perigos = salasData.filter(s => (s.tipo === 'gas' || s.tipo === 'mina') && !s.bloqueada);
            if(perigos.length > 0) {
                let revelada = perigos[Math.floor(Math.random() * perigos.length)];
                io.emit('mensagem', { texto: `🕵️ ESPIÃO: CUIDADO COM A SALA ${revelada.id}!`, cor: "#00b0ff" });
            }
        }

        // Verifica Morte do Jogador Atual
        if(jogador.vidas <= 0) {
            jogador.vivo = false;
            jogador.temChave = false;
        }

        io.emit('salaOcupada', { idSala: idSala, jogador: jogador, efeito: sala.tipo, msg: msgExtra });
        io.emit('atualizarLista', Object.values(jogadores));

        turnoIndex++;
        setTimeout(processarProximoTurno, 1000);
    }
}

function faseExplosao() {
    if(!jogoAndando) return;
    
    // Mata 1 sem chave
    let alvos = ordemTurno.filter(j => j.vivo && j.sala && !j.temChave);
    
    if(alvos.length > 0) {
        let vitima = alvos[Math.floor(Math.random() * alvos.length)];
        vitima.vivo = false;
        vitima.vidas = 0;
        io.emit('efeitoExplosao', { idSala: vitima.sala, nome: vitima.nome });
        io.emit('mensagem', { texto: `💥 ${vitima.nome} FOI PEGO PELO ASSASSINO!`, cor: "red" });
    } else {
        io.emit('mensagem', { texto: "ASSASSINO NÃO ACHOU NINGUÉM!", cor: "yellow" });
    }

    io.emit('atualizarLista', Object.values(jogadores));
    
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
                if(hallDaFama.length > 5) hallDaFama.pop();
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
    sobreviventes.forEach(j => { 
        j.temChave = false; 
        j.sala = null;
    });
    
    jogadores = {};
    sobreviventes.forEach(j => jogadores[j.id] = j);
    
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
        io.emit('mensagem', { texto: "⚙️ NOVAS REGRAS APLICADAS!", cor: "#00e676" });
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
server.listen(PORT, () => { console.log(`SERVIDOR COM CAOS: ${PORT}`); });
