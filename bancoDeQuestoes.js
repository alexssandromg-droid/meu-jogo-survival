const questoes = [
    {
        id: 1,
        pergunta: "Em 1900, o presidente da Suíça arbitrou a 'Questão do Amapá'. O fim dessa questão resultou:",
        opcoes: {
            a: "Na entrega de parte do Amapá para a Inglaterra.",
            b: "No desfecho de um impasse de séculos, com vitória do Brasil sobre a França.",
            c: "Na pacificação devido à fuga de escravizados para a Guiana.",
            d: "Na demarcação da fronteira norte no rio Amazonas.",
            e: "Na criação de uma zona tampão sob controle suíço."
        },
        correta: "b",
        explicacao: "O Laudo Suíço (1900) deu vitória ao Brasil (defendido pelo Barão do Rio Branco), fixando a fronteira no Rio Oiapoque e encerrando o Contestado Franco-Brasileiro."
    },
    {
        id: 2,
        pergunta: "Com a criação do Território do Amapá em 1943, a segurança pública ficou a cargo de quem?",
        opcoes: {
            a: "De milícias e paramilitares.",
            b: "Da Guarda Territorial.",
            c: "Do Exército Brasileiro.",
            d: "Da Polícia Federal.",
            e: "Da Polícia da Floresta."
        },
        correta: "c",
        explicacao: "No início do Território Federal (contexto de 2ª Guerra), o Exército Brasileiro era incumbido do patrulhamento e segurança."
    },
    {
        id: 3,
        pergunta: "A resolução final da definição das fronteiras entre Amapá e Guiana Francesa ocorreu:",
        opcoes: {
            a: "Pelo Tratado de Santo Ildefonso.",
            b: "Com a Constituição de 1891.",
            c: "Pelo Tratado de Utrecht.",
            d: "Pelo Tribunal de Haia.",
            e: "Favorável ao Brasil após decisão da arbitragem suíça em 1900."
        },
        correta: "e",
        explicacao: "A arbitragem suíça de 1900 foi o marco definitivo da fronteira, dando ganho de causa ao Brasil."
    },
    {
        id: 4,
        pergunta: "Em qual contexto histórico o Amapá se tornou um Estado da Federação?",
        opcoes: {
            a: "Início da Primeira República (1900).",
            b: "Governo Ernesto Geisel.",
            c: "Governo Getúlio Vargas (1943).",
            d: "Governo Juscelino Kubitschek.",
            e: "Pela Constituição de 1988."
        },
        correta: "e",
        explicacao: "A Constituição de 1988 extinguiu os territórios federais, transformando o Amapá e Roraima em Estados."
    },
    {
        id: 5,
        pergunta: "O dia 5 de outubro é data comemorativa no Amapá. Esse fato marcou:",
        opcoes: {
            a: "A criação do estado do Amapá pela Constituição de 1988.",
            b: "A transição do regime militar.",
            c: "O início da ICOMI.",
            d: "A emancipação política do Norte.",
            e: "A criação da Guarda Territorial."
        },
        correta: "a",
        explicacao: "5 de outubro de 1988 é a data da promulgação da Constituição que criou o Estado do Amapá."
    },
    {
        id: 6,
        pergunta: "A Colônia Agrícola de Clevelândia (Oiapoque) serviu para aprisionar majoritariamente:",
        opcoes: {
            a: "Portugueses resistentes.",
            b: "Estrangeiros ilegais.",
            c: "Fugidos da Cabanagem.",
            d: "Presos políticos do governo Artur Bernardes (anos 1920).",
            e: "Negros quilombolas."
        },
        correta: "d",
        explicacao: "Clevelândia funcionou como campo de concentração para opositores políticos e anarquistas na década de 1920."
    },
    {
        id: 7,
        pergunta: "Antes do Tratado de Utrecht (Séc XVIII), quais potências disputavam a região do atual Amapá?",
        opcoes: {
            a: "Inglaterra, Alemanha e Áustria.",
            b: "Itália, Espanha e França.",
            c: "Holanda, Inglaterra e França.",
            d: "Holanda, Espanha e Áustria.",
            e: "EUA, Inglaterra e Holanda."
        },
        correta: "c",
        explicacao: "Além de Portugal, a região foi alvo de ingleses, holandeses e franceses interessados no delta do Amazonas."
    },
    {
        id: 8,
        pergunta: "A criação do Território do Amapá e sua transformação em Estado ocorreram, respectivamente, em:",
        opcoes: {
            a: "1900 e 1967.",
            b: "1713 e 1943.",
            c: "1840 e 1985.",
            d: "1939 e 1990.",
            e: "1943 e 1988."
        },
        correta: "e",
        explicacao: "Território criado por Vargas em 1943 (Decreto 5.812) e Estado criado pela Constituição de 1988."
    },
    {
        id: 9,
        pergunta: "Na primeira metade do século XX, qual atividade conectou o Amapá à economia mundial?",
        opcoes: {
            a: "Pecuária bovina.",
            b: "Cultivo de soja.",
            c: "Criação de lagosta.",
            d: "Extração do látex (borracha).",
            e: "Especiarias do sertão."
        },
        correta: "d",
        explicacao: "O Ciclo da Borracha (látex) foi o grande motor econômico da região antes da mineração industrial."
    },
    {
        id: 10,
        pergunta: "Sobre a 'Operação Amazônia' e o regime militar (anos 60), o objetivo era:",
        opcoes: {
            a: "Industrializar urgente o Amapá.",
            b: "Reprimir forças subversivas apenas.",
            c: "Atrair investimentos para ocupar a região despovoada.",
            d: "Interesses políticos e econômicos conjuntos para ocupação e controle.",
            e: "Combater apenas forças estrangeiras."
        },
        correta: "d",
        explicacao: "O regime militar via a ocupação da Amazônia ("Integrar para não entregar") como estratégia geopolítica e econômica."
    },
    {
        id: 11,
        pergunta: "Duas manifestações do sincretismo cultural no Amapá são:",
        opcoes: {
            a: "Marabaixo e Festa de São Tiago.",
            b: "Boi-Bumbá e Maracatu.",
            c: "Festa de São José e Capoeira.",
            d: "Marujada e Círio.",
            e: "Festa de São Gonçalo e Folia de Reis."
        },
        correta: "a",
        explicacao: "O Marabaixo (cultura negra/religiosa) e a Festa de São Tiago (Mazagão, batalha de mouros e cristãos) são ícones culturais locais."
    },
    {
        id: 12,
        pergunta: "Por que a Cabanagem foi marcante para a história da região?",
        opcoes: {
            a: "Guerra civil entre Norte e Nordeste.",
            b: "Liderada por grandes proprietários apenas.",
            c: "Forte participação popular (índios, negros) contra a elite e descaso imperial.",
            d: "Movimento liderado por holandeses.",
            e: "Movimento de inspiração comunista."
        },
        correta: "c",
        explicacao: "A Cabanagem foi uma das revoltas mais populares do Brasil, onde a população pobre tomou o poder no Grão-Pará."
    },
    {
        id: 13,
        pergunta: "Sobre a história colonial (Analise): I. França reivindicou o Amapá. II. Tratado de Utrecht reconheceu o rio Oiapoque. Está correto:",
        opcoes: {
            a: "I, II e III.",
            b: "I, II e IV.",
            c: "II e IV.",
            d: "I e III.",
            e: "Todas estão corretas no contexto geral."
        },
        correta: "d",
        explicacao: "A França reivindicou o território (Contestado) e o Tratado de Utrecht (1713) foi o primeiro a citar o Oiapoque como limite."
    },
    {
        id: 14,
        pergunta: "A transformação de Território para Estado do Amapá ocorreu com:",
        opcoes: {
            a: "Constituição de 1967.",
            b: "Constituição de 1988.",
            c: "Plebiscito de 1946.",
            d: "Intervenção federal.",
            e: "Decreto de Getúlio Vargas."
        },
        correta: "b",
        explicacao: "A CF/88 extinguiu a figura dos territórios federais na região, elevando-os a Estado."
    },
    {
        id: 15,
        pergunta: "A mineração no Amapá se destaca, historicamente, pela extração de:",
        opcoes: {
            a: "Prata e Cobre.",
            b: "Diamante e Silício.",
            c: "Nióbio e Urânio.",
            d: "Ouro e Manganês.",
            e: "Tungstênio e Carvão."
        },
        correta: "d",
        explicacao: "O Ouro (Ciclo antigo e atual) e o Manganês (Serra do Navio/ICOMI) são os minérios mais relevantes da história econômica."
    }
];

module.exports = questoes;
