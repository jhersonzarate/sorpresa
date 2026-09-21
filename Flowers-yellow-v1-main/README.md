# Donde floreces · Experiencia 3D

Una escena continua a pantalla completa. El scroll abre una flor amarilla y cambia la cámara a lo largo de cinco momentos; el arrastre horizontal permite girarla. Los textos acompañan la escena sin convertirla en una landing page.

El girasol está acompañado de cuatro rosas amarillas tridimensionales a distintas alturas. Comparten una geometría de pétalos anchos dispuestos en espiral, con tallos y hojas, y crecen de forma escalonada al avanzar. El ramo gira como un conjunto y la cámara reserva espacio para las flores laterales en móvil. La versión ligera también dibuja cuatro rosas.

Las cinco flores parten ocultas: el girasol crece entre el inicio y el 30 % del recorrido; las rosas aparecen en intervalos escalonados hasta el 53,5 %. Volver hacia arriba revierte la aparición. La brisa combina dos oscilaciones suaves y cada rosa tiene su propio desfase. Se detiene al abrir la carta, ocultar la pestaña o solicitar movimiento reducido.

## Abrir

Abre `index.html` directamente o utiliza Live Server de VS Code. Conserva `index.html`, `styles.css` y `script.js` juntos. No requiere npm, compilación ni conexión a internet.

## Tecnología

- WebGL nativo: geometría tridimensional procedural para pétalos, semillas, hojas y tallo; iluminación mediante shaders, profundidad y cámara en perspectiva.
- Partículas de polen y apertura progresiva de pétalos vinculada al scroll.
- Pétalos que nacen y crecen en la corola de la flor, se desprenden y caen con giro y oscilación. Su origen se calcula con las mismas matrices de cámara, rotación y apertura del modelo 3D, incluso mientras se gira. Reaccionan al puntero o al dedo como una brisa. Se limita la cantidad a 22 en móvil y 44 en pantallas mayores, dibujados en una capa Canvas 2D detrás de la flor y sin bloquear el scroll. Se desvanecen al final de su recorrido; no se generan desde el cielo ni reaparecen en los bordes.
- HTML y CSS para las frases, controles y carta accesible.
- Sin bibliotecas, modelos, imágenes o fuentes externos. La textura sutil está incluida como SVG de ruido, no se descarga.
- Si WebGL no está disponible, muestra una flor 2D y avisa que está usando la versión ligera.

## Interacción y adaptación

Scroll vertical nativo; arrastre horizontal con mouse o dedo; flechas izquierda/derecha con el lienzo enfocado. Los cinco puntos inferiores permiten saltar entre momentos, y la flecha final vuelve al principio. Sin botón de pausa visible.

Un toque breve sobre la corola produce un pulso cálido de luz de 1,8 segundos, una expansión sutil y una ráfaga de pétalos nacidos de la flor (6 en móvil, 9 en escritorio). Enter o espacio activa el mismo gesto con el lienzo enfocado. El arrastre, el scroll y los toques fuera de la flor no activan el efecto. Se reserva capacidad para las ráfagas dentro del límite total de partículas.

El sistema respeta `prefers-reduced-motion`: desactiva el movimiento ambiental, el scroll animado y la interpolación. La escena aún responde directamente al progreso manual. El renderizado se detiene al ocultar la pestaña y mientras se lee la carta. La resolución y la frecuencia de dibujo están limitadas para reducir la carga.

Los pétalos comparten el ciclo de renderizado de la escena. Con movimiento reducido se mantienen estáticos y no reaccionan al puntero; también se desactiva el pulso al tocar.

## Alcance

La versión 2 configurable está en `version-2/index.html`, con tres retratos, juego de destellos, panel y `config.json`. La raíz conserva esta versión 1 estática.

Esta es una demostración estática. No integra JSON, panel de personalización, carga de fotos ni almacenamiento. Las frases están en HTML; el motor de la flor vive separado en JavaScript. La futura versión configurable necesitará un esquema JSON y un renderizador de textos validados.

La versión anterior se conserva en la subcarpeta `version-1-editorial` para comparación. No se publica ningún contenido en internet.
