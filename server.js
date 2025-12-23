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
    fatorPortas: 1.2,
    chanceBotKill: 0.3 
};

let jogadores = {}; 
let salasData = [];
let jogoAndando = false;
let ordemTurno = [];
let turnoIndex = 0;
let timerTurno = null;
let faseAtual = 1;
let hallDaFama = [];

// === AUXILIARES ===
function iniciarSalas(qtdJogadores) {
    let qtdPortas = Math.ceil(qtdJogadores * gameConfig.fatorPortas);
    if(qtdPortas < qtdJogadores) qtdPortas = qtdJogadores;

    let conteudos = ['chave']; 
    let qtdGas = Math.floor(qtdPortas * 0.20);
    let qtdVida = Math.floor(qtdPortas * 0.10);
    let qtdVampiro = Math.floor(qtdPortas * 0.05);
    let qtdTroca = Math.floor(qtdPortas * 0.05);
    let qtdMina = Math.floor(qtdPortas * 0.05);
    let qtdEspiao = Math.floor(qtdPortas * 0.05);

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
        io.emit('mensagem', { texto: "⚠️ FIM DA RODADA...", cor: "orange" });
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

    if(jogador.role === 'assassin' && Math.random() < gameConfig.chanceBotKill) {
        let vitimas = ordemTurno.filter(j => j.vivo && j.id !== jogador.id);
        if(vitimas.length > 0) {
            let alvo = vitimas[Math.floor(Math.random() * vitimas.length)];
            executarAssassinato(jogador, alvo.id);
            return;
        }
    }

    let salasLivres = salasData.filter(s => !s.bloqueada);
    if(salasLivres.length > 0) {
        let escolha = salasLivres[Math.floor(Math.random() * salasLivres.length)];
        resolverEntrada(escolha.id, jogador.id);
    } else {
        turnoIndex++;
        processarProximoTurno();
    }
}

// === AQUI MUDOU: PASSA A FACA ADIANTE ===
function executarAssassinato(assassino, idVitima) {
    let vitima = jogadores[idVitima];
    if(vitima && vitima.vivo) {
        vitima.vidas = 0;
        vitima.vivo = false;
        
        io.emit('mensagem', { texto: `🔪 ${assassino.nome} MATOU E PASSOU A FACA!`, cor: "#ff1744" });
        io.emit('efeitoKill', { idVitima: vitima.id }); 
        
        // 1. Remove cargo do assassino atual
        assassino.role = 'crew';
        if(!assassino.ehBot) io.to(assassino.id).emit('seuPapel', 'crew');

        // 2. Escolhe NOVO assassino entre os vivos (exceto quem acabou de matar)
        let possiveisNovos = Object.values(jogadores).filter(j => j.vivo && j.id !== assassino.id && j.id !== vitima.id);
        
        if(possiveisNovos.length > 0) {
            let novoAssassino = possiveisNovos[Math.floor(Math.random() * possiveisNovos.length)];
            novoAssassino.role = 'assassin';
            
            // Avisa o novo assassino
            if(!novoAssassino.ehBot) {
                io.to(novoAssassino.id).emit('seuPapel', 'assassin');
            }
            // Não avisa publicamente quem é o novo!
        }

        io.emit('atualizarLista', Object.values(jogadores));
        
        turnoIndex++;
        setTimeout(processarProximoTurno, 1500);
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

        if(sala.tipo === 'gas') jogador.vidas -= 1;
        else if(sala.tipo === 'vida') jogador.vidas += 1;
        else if(sala.tipo === 'chave') jogador.temChave = true;
        else if(sala.tipo === 'vampiro') {
            let vitimas = ordemTurno.filter(j => j.vivo && j.id !== jogador.id);
            if(vitimas.length > 0) {
                let alvo = vitimas[Math.floor(Math.random() * vitimas.length)];
                alvo.vidas -= 1; jogador.vidas += 1;
                if(alvo.vidas <= 0) alvo.vivo = false;
                msgExtra = ` (ROUBOU VIDA)`;
            }
        }
        else if(sala.tipo === 'troca') {
            let alvos = ordemTurno.filter(j => j.vivo && j.id !== jogador.id);
            if(alvos.length > 0) {
                let alvo = alvos[Math.floor(Math.random() * alvos.length)];
                let temp = jogador.vidas; jogador.vidas = alvo.vidas; alvo.vidas = temp;
                msgExtra = ` (TROCOU VIDAS)`;
            }
        }
        else if(sala.tipo === 'mina') {
            let vazias = salasData.filter(s => s.tipo === 'vazio' && !s.bloqueada);
            if(vazias.length > 0) {
                vazias[Math.floor(Math.random() * vazias.length)].tipo = 'gas';
                msgExtra = " (PLANTOU MINA)";
            }
        }
        else if(sala.tipo === 'espiao') {
            let perigos = salasData.filter(s => (s.tipo === 'gas' || s.tipo === 'mina') && !s.bloqueada);
            if(perigos.length > 0) {
                let rev = perigos[Math.floor(Math.random() * perigos.length)];
                io.emit('mensagem', { texto: `🕵️ ESPIÃO: SALA ${rev.id} É PERIGOSA!`, cor: "#00b0ff" });
            }
        }

        if(jogador.vidas <= 0) { 
            jogador.vivo = false; 
            jogador.temChave = false;
            // Se o assassino morrer na sala, a faca tem que passar pra outro?
            // Vamos deixar simples: se ele morre, a faca some até a proxima rodada.
        }

        io.emit('salaOcupada', { idSala: idSala, jogador: jogador, efeito: sala.tipo, msg: msgExtra });
        io.emit('atualizarLista', Object.values(jogadores));

        turnoIndex++;
        setTimeout(processarProximoTurno, 1000);
    }
}

function faseExplosao() {
    if(!jogoAndando) return;
    
    let alvos = ordemTurno.filter(j => j.vivo && j.sala && !j.temChave);
    
    if(alvos.length > 0) {
        let vitima = alvos[Math.floor(Math.random() * alvos.length)];
        vitima.vivo = false; vitima.vidas = 0;
        io.emit('efeitoExplosao', { idSala: vitima.sala, nome: vitima.nome });
        io.emit('mensagem', { texto: `💥 ${vitima.nome} FOI EXPLODIDO!`, cor: "red" });
    } else {
        io.emit('mensagem', { texto: "NINGUÉM EXPLODIU!", cor: "yellow" });
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
    }, 3000);
}

function iniciarNovaRodada(sobreviventes) {
    faseAtual++;
    jogadores = {}; 
    sobreviventes.forEach(j => { 
        j.temChave = false; 
        j.sala = null; 
        j.role = 'crew'; // Reseta tudo
        jogadores[j.id] = j;
    });
    
    let lista = Object.values(jogadores);

    // Sorteio Inicial da Rodada
    if(lista.length > 0) {
        let novoAssassino = lista[Math.floor(Math.random() * lista.length)];
        novoAssassino.role = 'assassin';
        if(!novoAssassino.ehBot) io.to(novoAssassino.id).emit('seuPapel', 'assassin');
    }

    salasData = iniciarSalas(lista.length);
    ordemTurno = lista.sort(() => Math.random() - 0.5);
    turnoIndex = 0;

    io.emit('novaRodada', { fase: faseAtual, salas: salasData, jogadores: lista });
    setTimeout(processarProximoTurno, 1000);
}

io.on('connection', (socket) => {
    atualizarContadorOnline();
    socket.emit('atualizarRanking', hallDaFama);
    socket.emit('configAtual', gameConfig);

    socket.on('adminLogin', (s) => socket.emit('adminLogado', s === 'admin'));
    socket.on('adminSalvarConfig', (n) => {
        if(n.maxJogadores) gameConfig.maxJogadores = parseInt(n.maxJogadores);
        if(n.vidasIniciais) gameConfig.vidasIniciais = parseInt(n.vidasIniciais);
        if(n.velocidadeBot) gameConfig.velocidadeBot = parseInt(n.velocidadeBot);
        io.emit('mensagem', { texto: "⚙️ REGRAS ATUALIZADAS!", cor: "#00e676" });
    });
    socket.on('adminZerarRank', () => { hallDaFama = []; io.emit('atualizarRanking', hallDaFama); });

    socket.on('entrar', (dados) => {
        jogadores[socket.id] = {
            id: socket.id, nome: dados.nome, tipo: dados.tipo,
            vidas: gameConfig.vidasIniciais, temChave: false, sala: null, vivo: true, ehBot: false, role: 'crew'
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
                vidas: gameConfig.vidasIniciais, temChave: false, sala: null, vivo: true, ehBot: true, role: 'crew'
            };
        }
        
        let listaCompleta = Object.values(jogadores);
        let assassino = listaCompleta[Math.floor(Math.random() * listaCompleta.length)];
        assassino.role = 'assassin';
        if(!assassino.ehBot) io.to(assassino.id).emit('seuPapel', 'assassin');

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

    socket.on('assassinarPlayer', (idAlvo) => {
        let jogadorDaVez = ordemTurno[turnoIndex];
        if(jogadorDaVez && jogadorDaVez.id === socket.id && jogadorDaVez.role === 'assassin') {
            executarAssassinato(jogadorDaVez, idAlvo);
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
server.listen(PORT, () => { console.log(`SERVIDOR ROTATIVO: ${PORT}`); });
