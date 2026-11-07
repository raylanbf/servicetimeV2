'use strict';

// Templates das capas de vídeo (imagens 1920×1080, carregadas pelo thumb.html).
// Para criar outro: ponha a imagem de fundo — sem o texto — em thumbs/ e
// acrescente uma entrada aqui. As medidas são em pixels da imagem:
//   box        área onde o texto entra (centralizado nela, nas duas direções)
//   maxSize    tamanho máximo da letra; texto comprido diminui até minSize
//   lineHeight distância entre as linhas, em vezes o tamanho da letra
// A fonte precisa estar declarada no thumb.css (@font-face).
window.THUMB_TEMPLATES = [
  {
    id: 'puc-azul',
    name: 'Azul — moldura arredondada',
    image: 'thumbs/puc-azul.png',
    // Moldura branca: lado de dentro em x 126–1793, y 336–743, com as pontas
    // arredondadas — a caixa fica longe das curvas.
    box: { x: 232, y: 355, w: 1456, h: 370 },
    font: 'Alegreya Sans', weight: 700, color: '#ffffff',
    maxSize: 106, minSize: 36, lineHeight: 1.155,
  },
  {
    id: 'puc-geometrico',
    name: 'Geométrico — moldura ciano',
    image: 'thumbs/puc-geometrico.png',
    // Moldura ciano: lado de dentro em x 109–1792, y 354–731.
    box: { x: 160, y: 372, w: 1582, h: 343 },
    font: 'Alegreya Sans', weight: 700, color: '#ffffff',
    maxSize: 100, minSize: 36, lineHeight: 1.155,
  },
  {
    id: 'puc-libras',
    name: 'Acessível em Libras',
    image: 'thumbs/puc-libras.png',
    box: { x: 160, y: 372, w: 1582, h: 343 },
    font: 'Alegreya Sans', weight: 700, color: '#ffffff',
    maxSize: 100, minSize: 36, lineHeight: 1.155,
  },
];
