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
    velocidadeBot: 1000,
    fatorPortas: 1.5, // Mais portas para ter espaço
    modoJogo: 'SOLO' // SOLO, DUPLA, SQUAD
};

// BANCO DE PALAVRAS DA FORCA
const listaPalavras = [
    "COMPUTADOR", "INTERNET", "BRASIL", "FUTEBOL", "ELEFANTE", 
    "GIRASSOL", "OCEANO", "UNIVERSO", "TECLADO", "ABACAXI",
    "FLORESTA", "GUITARRA", "AMIZADE", "BATATA", "DIAMANTE",
    "MONTANHA", "PIRATA", "ROBO", "ESPADA", "DRAGAO"
];

let jogadores = {}; 
let salasData = [];
let jogoAndando = false;
let ordemTurno = [];
let turnoIndex = 0;
let timerTurno = null;
let faseAtual = 1;
let hallDaFama = [];

// Variáveis Aposta
let apostas = {}; // { idApostador: idCandidato }

// Variáveis Forca
let hangmanAtivo = false;
let duelistas = []; // [p1, p2]
let hangmanState = {
    palavra: "",
    descoberta: [], // ['_', '_', 'A', '_']
    erros: { p1: 0, p2: 0 },
    vez: 0, // 0 ou 1
    letrasUsadas: []
};

// === AUXILIARES ===
function iniciarSalas(qtdJogadores) {
    let qtdPortas = Math.ceil(qtdJogadores * gameConfig.fatorPortas);
    if(qtdPortas < qtdJogadores) qtdPortas = qtdJogadores;

    let conteudos = [];
    
    // Distribuição Mortal
    let qtdDuelo = Math.floor(qtdPortas * 0.30); // 30% das portas causam DUELO (Morte certa pra um)
    let qtdRevive = Math.floor(qtdPortas * 0.10); // 10% Ressuscitar
    
    for(let i=0; i<qtdDuelo; i++) conteudos.push('duelo');
    for(let i=0; i<qtdRevive; i++) conteudos.push('revive');
    
    // O resto é vazio (seguro)
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
    if(!jogoAndando || hangmanAtivo) return;
    clearTimeout(timerTurno);

    // Verifica Vitoria
    if(verificarVitoria()) return;

    if(turnoIndex >= ordemTurno.length) {
        // Fim da rodada, apenas reseta salas e continua
        iniciarNovaRodada(Object.values(jogadores).filter(j => j.vivo));
        return;
    }

    let jogadorAtual = ordemTurno[turnoIndex];
    
    // Pula mortos
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
            // Humano demorou? Joga aleatório pra ele
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
        let msgExtra = "";

        // === LÓGICA DAS PORTAS ===
        
        if(sala.tipo === 'duelo') {
            // PUXA PRO MINIGAME
            let oponentes = Object.values(jogadores).filter(j => j.vivo && j.id !== jogador.id);
            
            if(oponentes.length > 0) {
                let oponente = oponentes[Math.floor(Math.random() * oponentes.length)];
                io.emit('salaOcupada', { idSala: idSala, jogador: jogador, efeito: 'duelo' });
                io.emit('mensagem', { texto: `⚔️ ${jogador.nome} ABRIU UM DUELO CONTRA ${oponente.nome}!`, cor: "red" });
                
                // Pausa turno e vai pra aposta
                setTimeout(() => iniciarFaseApostas(jogador, oponente), 1500);
                return; // PARA O FLUXO AQUI
            } else {
                msgExtra = " (SEM OPONENTES!)";
                io.emit('salaOcupada', { idSala: idSala, jogador: jogador, efeito: 'vazio' });
            }
        }
        else if(sala.tipo === 'revive') {
            if(gameConfig.modoJogo === 'SOLO') {
                msgExtra = " (INÚTIL NO SOLO)";
                io.emit('salaOcupada', { idSala: idSala, jogador: jogador, efeito: 'revive', msg: msgExtra });
            } else {
                // Tenta reviver alguém do mesmo time
                let mortosDoTime = Object.values(jogadores).filter(j => !j.vivo && j.tipo === jogador.tipo);
                if(mortosDoTime.length > 0) {
                    let sortudo = mortosDoTime[0]; // Pega o primeiro
                    sortudo.vivo = true;
                    sortudo.vidas = 1; 
                    msgExtra = ` (RESSUSCITOU ${sortudo.nome}!)`;
                    io.emit('salaOcupada', { idSala: idSala, jogador: jogador, efeito: 'revive', msg: msgExtra });
                    io.emit('mensagem', { texto: `😇 MILAGRE! ${sortudo.nome} ESTÁ DE VOLTA!`, cor: "#00e676" });
                } else {
                    msgExtra = " (NINGUÉM PRA SALVAR)";
                    io.emit('salaOcupada', { idSala: idSala, jogador: jogador, efeito: 'revive', msg: msgExtra });
                }
            }
        }
        else {
            // VAZIO / SEGURO
            io.emit('salaOcupada', { idSala: idSala, jogador: jogador, efeito: 'vazio' });
        }

        io.emit('atualizarLista', Object.values(jogadores));
        turnoIndex++;
        setTimeout(processarProximoTurno, 1000);
    }
}

// 1. FASE DE APOSTAS
function iniciarFaseApostas(p1, p2) {
    apostas = {};
    duelistas = [p1, p2];
    
    io.emit('abrirApostasUI', { p1: p1, p2: p2 });
    io.emit('mensagem', { texto: `💰 APOSTEM NA VÍTIMA OU NO SOBREVIVENTE!`, cor: "gold" });

    // Bots apostam
    Object.values(jogadores).filter(j => j.ehBot && j.vivo && j.id !== p1.id && j.id !== p2.id).forEach(bot => {
        setTimeout(() => {
            // Se for do time, aposta no amigo. Se não, aleatório.
            let aposta = (bot.tipo === p1.tipo) ? p1.id : (bot.tipo === p2.tipo ? p2.id : (Math.random()>0.5 ? p1.id : p2.id));
            apostas[bot.id] = aposta;
        }, 1500);
    });

    setTimeout(() => {
        io.emit('fecharApostasUI');
        iniciarForca(p1, p2);
    }, 6000); // 6s para apostar
}

// 2. MINIGAME: FORCA (HANGMAN)
function iniciarForca(p1, p2) {
    hangmanAtivo = true;
    
    // Sorteia palavra
    let palavraRaw = listaPalavras[Math.floor(Math.random() * listaPalavras.length)];
    
    hangmanState = {
        palavra: palavraRaw,
        descoberta: Array(palavraRaw.length).fill('_'),
        erros: {},
        vez: 0, // Começa player 1
        letrasUsadas: []
    };
    hangmanState.erros[p1.id] = 0;
    hangmanState.erros[p2.id] = 0;

    io.emit('iniciarForcaUI', { p1: p1, p2: p2, tamanho: palavraRaw.length });
    io.emit('mensagem', { texto: `🔤 JOGO DA FORCA: ${p1.nome} vs ${p2.nome}`, cor: "#ff00ff" });

    processarTurnoForca();
}

function processarTurnoForca() {
    if(!hangmanAtivo) return;
    let atual = duelistas[hangmanState.vez];
    
    io.emit('forcaUpdate', { 
        palavra: hangmanState.descoberta, 
        vezId: atual.id, 
        erros: hangmanState.erros,
        usadas: hangmanState.letrasUsadas
    });

    // Bot joga
    if(atual.ehBot) {
        setTimeout(() => {
            let alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
            let letra = "";
            // Bot inteligente: tenta vogais primeiro ou aleatorio
            let tentativas = 0;
            do {
                let idx = Math.floor(Math.random() * 26);
                letra = alfabeto[idx];
                tentativas++;
            } while (hangmanState.letrasUsadas.includes(letra) && tentativas < 50);
            
            receberChuteForca(atual.id, letra);
        }, 1500);
    }
}

function receberChuteForca(idJogador, letra) {
    if(!hangmanAtivo) return;
    let atual = duelistas[hangmanState.vez];
    if(atual.id !== idJogador) return;
    if(hangmanState.letrasUsadas.includes(letra)) return; // Já foi

    hangmanState.letrasUsadas.push(letra);
    let acertou = false;

    // Verifica letra
    for(let i=0; i<hangmanState.palavra.length; i++) {
        if(hangmanState.palavra[i] === letra) {
            hangmanState.descoberta[i] = letra;
            acertou = true;
        }
    }

    if(acertou) {
        // Se acertou, verifica vitoria ou joga de novo?
        // Regra: Acertou -> Mantém a vez. 
        // Ver se completou
        if(!hangmanState.descoberta.includes('_')) {
            encerrarForca(atual); // Venceu quem completou
            return;
        }
        // Joga de novo
        processarTurnoForca();
    } else {
        // Errou
        hangmanState.erros[atual.id]++;
        // Se cometer 5 erros, morre
        if(hangmanState.erros[atual.id] >= 5) {
            let vencedor = duelistas.find(p => p.id !== atual.id);
            encerrarForca(vencedor); // O outro vence por WO
            return;
        }
        
        // Passa a vez
        hangmanState.vez = (hangmanState.vez === 0) ? 1 : 0;
        processarTurnoForca();
    }
}

// 3. FIM DO MINIGAME
function encerrarForca(vencedor) {
    hangmanAtivo = false;
    let perdedor = duelistas.find(p => p.id !== vencedor.id);
    
    io.emit('forcaFim', { palavra: hangmanState.palavra }); // Mostra palavra
    io.emit('mensagem', { texto: `🏆 ${vencedor.nome} VENCEU A FORCA!`, cor: "#00e676" });

    setTimeout(() => {
        aplicarConsequencias(vencedor, perdedor);
    }, 3000);
}

function aplicarConsequencias(vencedor, perdedor) {
    // 1. Mata perdedor
    perdedor.vivo = false;
    perdedor.vidas = 0;
    io.emit('efeitoKill', { idVitima: perdedor.id });
    io.emit('mensagem', { texto: `☠️ ${perdedor.nome} FOI ENFORCADO!`, cor: "red" });

    // 2. Mata quem apostou errado
    let apostadores = Object.values(jogadores).filter(j => j.vivo && j.id !== vencedor.id && j.id !== perdedor.id);
    
    let mortosAposta = 0;
    apostadores.forEach(ap => {
        let voto = apostas[ap.id];
        // Quem não votou (afk) ou votou errado -> MORRE
        if(voto !== vencedor.id) {
            ap.vivo = false;
            ap.vidas = 0;
            io.emit('efeitoKill', { idVitima: ap.id });
            mortosAposta++;
        }
    });

    if(mortosAposta > 0) {
        io.emit('mensagem', { texto: `💸 ${mortosAposta} JOGADORES ERRARAM A APOSTA E FORAM ELIMINADOS!`, cor: "#ff1744" });
    }

    io.emit('atualizarLista', Object.values(jogadores));
    io.emit('fecharForcaUI');

    // Segue o jogo
    turnoIndex++;
    setTimeout(processarProximoTurno, 2000);
}

// 4. VERIFICAÇÃO DE VITÓRIA
function verificarVitoria() {
    let vivos = Object.values(jogadores).filter(j => j.vivo);
    if(vivos.length === 0) return false; // Ninguém viveu

    if(gameConfig.modoJogo === 'SOLO') {
        if(vivos.length === 1) {
            finalizarJogo(vivos[0]);
            return true;
        }
    } else {
        // Modos Equipe: Verifica se só sobrou 1 time
        let timesVivos = [...new Set(vivos.map(j => j.tipo))];
        if(timesVivos.length === 1) {
            let nomeTime = traduzirTime(timesVivos[0]);
            finalizarJogo({ nome: `EQUIPE ${nomeTime}`, tipo: timesVivos[0] });
            return true;
        }
    }
    return false;
}

function finalizarJogo(campeao) {
    jogoAndando = false;
    hallDaFama.unshift({ nome: campeao.nome, data: new Date().toLocaleTimeString('pt-BR') });
    io.emit('fimDeJogo', { campeao: campeao });
    io.emit('atualizarRanking', hallDaFama);
}

function traduzirTime(tipo) {
    if(tipo==='p1') return "VERDE";
    if(tipo==='p2') return "AZUL";
    if(tipo==='p3') return "VERMELHA";
    if(tipo==='p4') return "AMARELA";
    return "DESCONHECIDO";
}

function iniciarNovaRodada(sobreviventes) {
    faseAtual++;
    sobreviventes.forEach(j => { j.sala = null; });
    
    let vivos = Object.values(jogadores).filter(j => j.vivo);
    if(vivos.length === 0) return; // Game over

    salasData = iniciarSalas(vivos.length);
    // Embaralha ordem
    ordemTurno = vivos.sort(() => Math.random() - 0.5);
    turnoIndex = 0;

    io.emit('novaRodada', { fase: faseAtual, salas: salasData, jogadores: Object.values(jogadores) });
    setTimeout(processarProximoTurno, 1000);
}

// === CONEXÃO ===
io.on('connection', (socket) => {
    atualizarContadorOnline();
    socket.emit('atualizarRanking', hallDaFama);
    // Envia modo atual
    socket.emit('modoAtual', gameConfig.modoJogo);

    socket.on('adminLogin', (s) => socket.emit('adminLogado', s === 'admin'));
    
    // Admin muda modo
    socket.on('mudarModo', (modo) => {
        gameConfig.modoJogo = modo;
        io.emit('modoAtual', modo); // Avisa todos
        io.emit('mensagem', { texto: `MUDANÇA DE MODO: ${modo}`, cor: "cyan" });
    });

    socket.on('adminZerarRank', () => { hallDaFama = []; io.emit('atualizarRanking', hallDaFama); });

    socket.on('entrar', (dados) => {
        // Se for solo, tipo é unico? Não, usa cores pra diferenciar visualmente, mas lógica ignora
        jogadores[socket.id] = {
            id: socket.id, nome: dados.nome, tipo: dados.tipo,
            vidas: 1, // Hit Kill
            sala: null, vivo: true, ehBot: false
        };
        io.emit('atualizarLista', Object.values(jogadores));
    });

    socket.on('iniciarJogo', () => {
        if(jogoAndando) return;
        let lista = Object.values(jogadores);
        let qtdFaltante = gameConfig.maxJogadores - lista.length;
        if(qtdFaltante < 0) qtdFaltante = 0;

        // Distribuição de Bots conforme Modo
        const times = ['p1', 'p2', 'p3', 'p4'];
        
        for(let i=1; i<=qtdFaltante; i++) {
            let idBot = `bot-${Date.now()}-${i}`;
            let timeBot = 'p1';
            
            if(gameConfig.modoJogo === 'SOLO') timeBot = times[i % 4]; // Apenas visual
            if(gameConfig.modoJogo === 'DUPLA') timeBot = times[Math.floor(i/2) % 4]; // Tenta parear
            if(gameConfig.modoJogo === 'SQUAD') timeBot = times[i % 4]; // Distribui 4 times

            jogadores[idBot] = {
                id: idBot, nome: `Bot ${i}`, tipo: timeBot,
                vidas: 1, sala: null, vivo: true, ehBot: true
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

    socket.on('fazerAposta', (idCandidato) => {
        apostas[socket.id] = idCandidato;
    });

    // INPUT FORCA
    socket.on('chuteForca', (letra) => {
        if(hangmanAtivo) receberChuteForca(socket.id, letra);
    });

    socket.on('disconnect', () => {
        if(jogadores[socket.id]) { jogadores[socket.id].vivo = false; delete jogadores[socket.id]; }
        io.emit('atualizarLista', Object.values(jogadores));
        atualizarContadorOnline();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`SERVIDOR FORCA MORTAL: ${PORT}`); });
