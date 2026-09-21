'use strict';

/* Escena WebGL autónoma. Geometría, luz y cámara reales, sin bibliotecas ni red. */
(() => {
  const canvas = document.querySelector('#scene');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (x,a=0,b=1) => Math.max(a,Math.min(b,x));
  const lerp = (a,b,t) => a+(b-a)*t;
  const smooth = (a,b,x) => {const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
  const TAU=Math.PI*2;
  let paused=reduced.matches, progress=0, targetProgress=0, active=-1;
  let rotation=0, wantedRotation=0, drag=null, animation=0, time=0, previous=0, frameTime=0;
  let dirty=true, inDialog=false, width=1,height=1, pixelRatio=1;
  let renderer=null, contextLost=false;
  let caressStart=-100;
  const chapters=[...document.querySelectorAll('.chapter')];
  const words=[...document.querySelectorAll('.words')];
  const steps=[...document.querySelectorAll('[data-step]')];
  const nextButton=document.querySelector('#next');
  const letter=document.querySelector('#letter');
  const useFlowerSprite=true;

  const kittyAssets = [
    { el: null, name: 'hero', revealStart: 0.14, revealEnd: 0.34, size: 2.05, xBias: 0, yBias: 0, scale: 1.15 },
    { el: null, name: 'small-left', revealStart: 0.42, revealEnd: 0.68, size: 0.9, xBias: -0.25, yBias: 0.15, scale: 0.8 },
    { el: null, name: 'small-right', revealStart: 0.42, revealEnd: 0.68, size: 0.9, xBias: 0.25, yBias: 0.15, scale: 0.8 }
  ];

  kittyAssets.forEach((kitty, index) => {
    const img = new Image();
    img.src = 'hellokitty.png';
    img.alt = '';
    img.className = `flower-asset kitty-asset kitty-${index}`;
    kitty.el = img;
    document.body.appendChild(img);
    img.onload = () => img.classList.add('ready');
  });

  function updateFlowerAsset(state){
    kittyAssets.forEach((kitty, index) => {
      const asset = kitty.el;
      if(!asset || !asset.complete) return;

      const reveal = clamp((progress - kitty.revealStart) / (kitty.revealEnd - kitty.revealStart), 0, 1);
      const sizeFactor = Math.min(width / 1800, 1);
      const baseScale = index === 0 ? (0.72 + reveal * 0.9) : (0.62 + reveal * 0.42);
      const heroWidth = index === 0 ? Math.min(width * 0.46, 680) : Math.min(width * 0.22, 260);
      const x = width * (0.5 + kitty.xBias) + Math.sin(time * (0.55 + index * 0.08)) * (index === 0 ? 6 : 3.8);
      const y = height * (0.58 + kitty.yBias) + Math.cos(time * (0.72 + index * 0.09)) * (index === 0 ? 4.2 : 2.8) + (1 - reveal) * 20;
      const tiltX = (0.4 - progress) * (index === 0 ? 2.8 : 2.2) + Math.cos(time * (0.7 + index * 0.12)) * (index === 0 ? 0.9 : 0.6);
      const tiltY = rotation * (index === 0 ? 10 : 8) + Math.sin(time * (0.72 + index * 0.14) + index) * (index === 0 ? 1.7 : 1.3);
      const tiltZ = Math.sin(time * (0.9 + index * 0.1)) * (index === 0 ? 1.2 : 0.9);

      asset.style.zIndex = '0';

      if(reveal <= 0.04){
        asset.style.opacity = '0';
        asset.style.filter = 'blur(2px)';
        asset.style.transform = `translate(-50%, -50%) scale(${0.78 * kitty.scale})`;
        asset.style.left = `${x}px`;
        asset.style.top = `${y}px`;
        asset.style.width = `${heroWidth * sizeFactor * baseScale}px`;
        return;
      }

      asset.style.left = `${x}px`;
      asset.style.top = `${y}px`;
      asset.style.width = `${heroWidth * sizeFactor * baseScale}px`;
      asset.style.opacity = (0.12 + reveal * 0.88).toFixed(4);
      asset.style.filter = `drop-shadow(0 12px 10px rgba(214,76,146,.06)) blur(${(1 - reveal) * 0.65}px)`;
      asset.style.transform = `translate(-50%, -50%) scale(${(0.76 + reveal * 0.36) * kitty.scale}) rotateX(${tiltX}deg) rotateY(${tiltY}deg) rotateZ(${tiltZ}deg)`;
    });
  }

  // Petals grow from projected points on the corolla, then drift into the background.
  const petalRain=makePetalRain();
  function makePetalRain(){
    const layer=document.createElement('canvas');
    layer.id='petal-rain';layer.setAttribute('aria-hidden','true');canvas.before(layer);
    const ctx=layer.getContext('2d');
    if(!ctx)return {resize(){},draw(){},resetWind(){},burst(){},contains(){return false;}};
    const petals=[];
    const hand={x:-1000,y:-1000,dx:0,dy:0,last:0,active:false};
    let seed=19721,wind=0,emissionClock=0,burstPending=0;
    const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
    function newPetal(){
      const depth=random();
      return {x:0,y:0,active:false,age:0,life:9+random()*5,petal:Math.floor(random()*18),
        depth,size:7+depth*13,fall:13+depth*20,phase:random()*TAU,
        spin:(random()-.5)*1.3,angle:random()*TAU,vx:0,vy:0,outX:0,outY:0};
    }
    function project(matrix,point){
      const clip=[0,0,0,0];
      for(let row=0;row<4;row++)clip[row]=matrix[row]*point[0]+matrix[4+row]*point[1]+matrix[8+row]*point[2]+matrix[12+row];
      if(clip[3]<=.01)return null;
      return {x:(clip[0]/clip[3]+1)*.5,y:(1-clip[1]/clip[3])*.5};
    }
    function origin(p,state,matrix){
      const angle=p.petal/18*TAU;
      if(canvas.dataset.renderer==='canvas-fallback'){
        const base=Math.min(width*.23,height*.17),reveal=state.sunflowerReveal??1;
        const r=base*reveal*(.3+state.bloom*.7);
        const a=angle+rotation*.2+Math.sin(state.t*.2)*.025;
        return {x:.5+(Math.sin(a)*r+state.wind*base*2)/width,y:.34+(base*2.1*(1-reveal)-Math.cos(a)*r)/height};
      }
      // Match the outer petal's mesh and its opening deformation in the vertex shader.
      const t=.97,length=1.47*(1+Math.sin(p.petal*9.7)*.065),r=.23+length*t;
      const opening=.15+.85*state.bloom;
      const z=.04+.19*Math.sin(t*Math.PI)-.23*t*t+.003*Math.sin(t*Math.PI)+.006+(1-state.bloom)*r*.92;
      return project(matrix,[Math.sin(angle)*r*opening,.55+Math.cos(angle)*r*opening,z]);
    }
    function emit(p,state,matrix,center){
      if((state.sunflowerReveal??1)<.3)return;
      Object.assign(p,newPetal());
      const source=origin(p,state,matrix);
      if(!source||source.x<-.1||source.x>1.1||source.y<-.1||source.y>1.1)return;
      p.x=source.x;p.y=source.y;p.active=true;
      const dx=(source.x-center.x)*width,dy=(source.y-center.y)*height,d=Math.max(1,Math.hypot(dx,dy));
      const speed=22+random()*24;
      p.outX=dx/d*speed;p.outY=dy/d*speed*.55-12;
    }
    function corolla(state){
      const matrix=multiply(state.projection,multiply(state.view,state.model));
      const base=Math.min(width*.23,height*.17);
      const center=canvas.dataset.renderer==='canvas-fallback'?{x:.5+(state.wind||0)*base*2/width,y:.34+base*2.1*(1-(state.sunflowerReveal??1))/height}:project(matrix,[0,.55,0]);
      const outline=Array.from({length:18},(_,petal)=>origin({petal},state,matrix)).filter(Boolean);
      return {matrix,center,outline};
    }
    function track(event){
      if(paused||reduced.matches||inDialog)return;
      const now=performance.now();
      if(hand.active&&now-hand.last<140){
        hand.dx=clamp(event.clientX-hand.x,-55,55);hand.dy=clamp(event.clientY-hand.y,-40,40);
        wind=clamp(wind+hand.dx*.2,-65,65);
      }else{hand.dx=0;hand.dy=0;}
      hand.x=event.clientX;hand.y=event.clientY;hand.last=now;hand.active=true;
    }
    canvas.addEventListener('pointermove',track,{passive:true});
    canvas.addEventListener('pointerdown',track,{passive:true});
    canvas.addEventListener('pointerleave',()=>{hand.active=false;});
    canvas.addEventListener('pointercancel',()=>{hand.active=false;});
    canvas.addEventListener('pointerup',event=>{if(event.pointerType!=='mouse')hand.active=false;});
    return {
      burst(){burstPending=width<700?6:9;},
      contains(state,x,y){
        const outlines=(state.sunflowerReveal??1)>.15?[corolla(state).outline]:[];
        if(canvas.dataset.renderer==='canvas-fallback'){
          const radius=Math.min(width*.23,height*.17);
          for(const [index,[dx,dy,size]] of [[-1.08,.65,.58],[1.04,.5,.56],[-.55,1.3,.44],[.53,1.22,.46]].entries()){
            const reveal=state.roses?.[index].opening??1;if(reveal<.15)continue;
            const r=radius*size*reveal;
            outlines.push(Array.from({length:18},(_,i)=>({x:.5+(dx*radius+(state.wind||0)*radius*(index+1)*.6+Math.sin(i/18*TAU)*r)/width,y:.34+(dy*radius+radius*1.3*(1-reveal)+Math.cos(i/18*TAU)*r)/height})));
          }
        }
        if(canvas.dataset.renderer!=='canvas-fallback')for(const rose of state.roses||[]){
          if(rose.scale<.1)continue;
          const matrix=multiply(state.projection,multiply(state.view,rose.model));
          outlines.push(Array.from({length:18},(_,i)=>project(matrix,[Math.sin(i/18*TAU)*.84,.55+Math.cos(i/18*TAU)*.84,.16])).filter(Boolean));
        }
        x/=width;y/=height;
        return outlines.some(outline=>{
          let inside=false;
          for(let i=0,j=outline.length-1;i<outline.length;j=i++){
            const a=outline[i],b=outline[j];
            if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)inside=!inside;
          }
          return inside;
        });
      },
      resetWind(){wind=0;burstPending=0;hand.active=false;petals.forEach(p=>{p.vx=0;p.vy=0;});},
      resize(){
        const ratio=Math.min(pixelRatio,1.5);
        layer.width=Math.round(width*ratio);layer.height=Math.round(height*ratio);ctx.setTransform(ratio,0,0,ratio,0,0);
        const count=width<700?22:44;
        while(petals.length<count)petals.push(newPetal());petals.length=count;
        layer.dataset.count=String(count);
      },
      draw(state,dt,animate){
        ctx.clearRect(0,0,width,height);
        const t=reduced.matches?0:state.t;
        const seconds=animate?dt/1000:0;
        const {matrix,center,outline}=corolla(state);
        if(center&&state.caress>0){
          const radius=Math.max(30,...outline.map(p=>Math.hypot((p.x-center.x)*width,(p.y-center.y)*height)))*(1.45+state.caress*.55);
          const glow=ctx.createRadialGradient(center.x*width,center.y*height,0,center.x*width,center.y*height,radius);
          glow.addColorStop(0,'rgba(255, 240, 250, 0.95)');
          glow.addColorStop(.18,'rgba(255, 173, 212, 0.9)');
          glow.addColorStop(.42,'rgba(255, 122, 186, 0.7)');
          glow.addColorStop(1,'rgba(255, 122, 186, 0)');
          ctx.save();ctx.globalAlpha=state.caress*.62;ctx.fillStyle=glow;
          ctx.fillRect(center.x*width-radius,center.y*height-radius,radius*2,radius*2);ctx.restore();
        }
        if(seconds){
          if(center&&burstPending){
            for(const p of petals){if(!p.active&&burstPending>0){emit(p,state,matrix,center);burstPending--;}}
            burstPending=0;
          }
          wind*=Math.exp(-seconds*1.7);if(performance.now()-hand.last>650)hand.active=false;
          emissionClock-=seconds;
          if(emissionClock<=0&&center){
            const free=petals.filter(p=>p.active).length<petals.length-(width<700?6:9)?petals.find(p=>!p.active):null;
            if(free)emit(free,state,matrix,center);
            emissionClock=(width<700?.55:.32)*(1.25-state.bloom*.35);
          }
        }
        for(const p of petals){
          if(!p.active)continue;
          if(seconds){
            p.age+=seconds;
            if(p.age>p.life||p.x<-.15||p.x>1.15||p.y>1.12||p.y<-.3){p.active=false;continue;}
            // During growth, stay attached even if the flower or camera turns.
            if(p.age<.65){const source=origin(p,state,matrix);if(source){p.x=source.x;p.y=source.y;}}
            const sway=Math.sin(t*.55+p.phase)*(5+p.depth*8);
            let forceX=0,forceY=0;
            if(hand.active){
              const dx=p.x*width-hand.x,dy=p.y*height-hand.y;
              const radius=Math.min(width,height)*.24,dist=Math.hypot(dx,dy),force=Math.max(0,1-dist/radius);
              forceX=(dx/Math.max(dist,1)*90+hand.dx*2)*force;
              forceY=(dy/Math.max(dist,1)*55+hand.dy)*force;
            }
            const response=1-Math.exp(-seconds*3);
            p.vx=lerp(p.vx,forceX,response);p.vy=lerp(p.vy,forceY,response);
            if(p.age>=.65){
              const release=smooth(.65,2.2,p.age);
              p.x+=(p.outX*Math.exp(-p.age*.11)+sway+wind*(.4+p.depth*.6)+p.vx)*seconds/width;
              p.y+=(lerp(p.outY,p.fall,release)+p.vy)*seconds/height;
            }
          }
          const flutter=Math.sin(t*.8+p.phase);
          const growth=smooth(0,.85,p.age),fade=1-smooth(p.life-2,p.life,p.age);
          const size=p.size*(width<700?.88:1)*growth;
          ctx.save();ctx.translate(p.x*width,p.y*height);
          ctx.rotate(p.angle+t*p.spin*.38+flutter*.22);
          ctx.scale(.3+Math.abs(Math.cos(t*.65+p.phase))*.7,1);
          ctx.globalAlpha=(.38+p.depth*.43)*(.8+flutter*.12)*growth*fade;
          const tint=ctx.createLinearGradient(-size*.3,-size,size*.35,size*.75);
          if(p.petal%3===0){tint.addColorStop(0,'#ffb3d6');tint.addColorStop(.42,'#f06fa8');tint.addColorStop(1,'#c22a72');}
          else{tint.addColorStop(0,'#ffdc86');tint.addColorStop(.42,'#e6b748');tint.addColorStop(1,'#a96718');}
          ctx.fillStyle=tint;ctx.beginPath();ctx.moveTo(0,-size*.85);
          ctx.bezierCurveTo(-size*.76,-size*.38,-size*.53,size*.46,size*.1,size*.85);
          ctx.bezierCurveTo(size*.6,size*.34,size*.53,-size*.53,0,-size*.85);ctx.fill();
          ctx.strokeStyle='#fff0b75c';ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(0,-size*.65);ctx.quadraticCurveTo(-size*.1,0,size*.08,size*.65);ctx.stroke();
          ctx.restore();
        }
        layer.dataset.active=String(petals.filter(p=>p.active).length);
      }
    };
  }

  const normalize=a=>{const n=Math.hypot(...a)||1;return a.map(x=>x/n);};
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const dot=(a,b)=>a.reduce((v,x,i)=>v+x*b[i],0);
  const identity=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  function multiply(a,b){const c=new Float32Array(16);for(let col=0;col<4;col++)for(let row=0;row<4;row++)for(let k=0;k<4;k++)c[col*4+row]+=a[k*4+row]*b[col*4+k];return c;}
  function rotateX(a){const m=identity(),c=Math.cos(a),s=Math.sin(a);m[5]=c;m[6]=s;m[9]=-s;m[10]=c;return m;}
  function rotateY(a){const m=identity(),c=Math.cos(a),s=Math.sin(a);m[0]=c;m[2]=-s;m[8]=s;m[10]=c;return m;}
  function rotateZ(a){const m=identity(),c=Math.cos(a),s=Math.sin(a);m[0]=c;m[1]=s;m[4]=-s;m[5]=c;return m;}
  function lookAt(eye,target){const z=normalize(eye.map((v,i)=>v-target[i])),x=normalize(cross([0,1,0],z)),y=cross(z,x);return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1]);}
  function perspective(aspect){const f=1/Math.tan(.69/2),near=.1,far=50;return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,-.18,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0]);}

  function createGeometry(kind='sunflower'){
    const vertices=[];
    function triangle(a,b,c,colors,part,normals){
      const n=normalize(cross(b.map((v,i)=>v-a[i]),c.map((v,i)=>v-a[i])));
      [a,b,c].forEach((v,i)=>vertices.push(...v,...(normals?normals[i]:n),...colors[i],part));
    }
    function surface(fn,color,nu,nv,part){
      for(let u=0;u<nu;u++)for(let v=0;v<nv;v++){
        const p=[[u/nu,v/nv],[(u+1)/nu,v/nv],[(u+1)/nu,(v+1)/nv],[u/nu,(v+1)/nv]];
        const q=p.map(([s,t])=>fn(s,t)),cs=p.map(([s,t])=>color(s,t));
        const normals=p.map(([s,t])=>{
          const up=fn(Math.min(1,s+.0001),t),um=fn(Math.max(0,s-.0001),t);
          const vp=fn(s,Math.min(1,t+.0001)),vm=fn(s,Math.max(0,t-.0001));
          return normalize(cross(up.map((x,i)=>x-um[i]),vp.map((x,i)=>x-vm[i])));
        });
        triangle(q[0],q[1],q[2],[cs[0],cs[1],cs[2]],part,[normals[0],normals[1],normals[2]]);triangle(q[0],q[2],q[3],[cs[0],cs[2],cs[3]],part,[normals[0],normals[2],normals[3]]);
      }
    }
    function sphere(center,radii,color,part,nu=14,nv=10){surface((u,v)=>{const a=u*TAU,b=v*Math.PI;return [center[0]+Math.sin(b)*Math.cos(a)*radii[0],center[1]+Math.sin(b)*Math.sin(a)*radii[1],center[2]+Math.cos(b)*radii[2]];},()=>color,nu,nv,part);}
    if(kind==='rose'){
      // Broad overlapping cups spiral around a closed heart, unlike the sunflower's rays.
      for(let ring=0;ring<5;ring++){
        const count=[6,5,5,4,4][ring],outer=.84-ring*.145;
        for(let j=0;j<count;j++){
          const angle=j/count*TAU+ring*2.39996;
          surface((u,v)=>{
            const a=angle+(v-.5)*1.55+u*.28;
            const scallop=Math.sin(v*Math.PI);
            const radius=outer*(.25+.75*Math.sin(u*Math.PI*.5))*(.70+.30*scallop)*(1+.05*Math.sin(j*8.2+ring));
            const z=.02+ring*.085+u*.36-.18*Math.pow(u,5)+.19*(1-scallop)*u*u+.04*Math.sin(angle)*u;
            return [Math.sin(a)*radius,.55+Math.cos(a)*radius,z];
          },(u,v)=>{
            const edge=Math.pow(u,3),fold=Math.sin(v*Math.PI);
            return [.75+.25*edge,.43+.37*edge+fold*.035,.07+.29*edge];
          },12,12,3);
        }
      }
      sphere([0,.55,.43],[.10,.115,.10],[.77,.46,.09],3,12,8);
    }else{
    // Two crowns of cupped petals, with subtle longitudinal veins and thickness.
    for(let layer=0;layer<2;layer++){
      const count=layer?15:18;
      for(let j=0;j<count;j++){
        const angle=j/count*TAU+layer*.13;
        const length=(layer?1.1:1.47)*(1+Math.sin(j*9.7)*.065);
        const petalWidth=layer?.235:.22;
        for(const side of [1,-1])surface((t,v)=>{
          const s=v*2-1;
          const taper=Math.pow(Math.max(.001,Math.sin(Math.PI*t)),.7);
          const lateral=s*petalWidth*taper;
          const radial=.23+length*t;
          const z=.04+layer*.085+.19*Math.sin(t*Math.PI)-.23*t*t+.13*s*s*taper+.003*Math.cos(s*Math.PI*4)*taper+side*.006;
          return [Math.sin(angle)*radial+Math.cos(angle)*lateral,.55+Math.cos(angle)*radial-Math.sin(angle)*lateral,z];
        },(t,v)=>{
          const stripe=.025*Math.cos(v*Math.PI*8);
          return [lerp(.63,1.0,smooth(0,.6,t))+stripe,lerp(.29,.77,t)+stripe,lerp(.035,.22,t)];
        },22,12,1);
      }
    }
    sphere([0,.55,.075],[.295,.295,.115],[.19,.13,.035],2,28,16);
    for(let i=0;i<300;i++){
      const radius=Math.sqrt((i+.5)/300)*.281,angle=i*2.399963;
      const z=.13+.07*Math.sqrt(Math.max(0,1-radius*radius/.085));
      const a=i%5/5;
      sphere([Math.cos(angle)*radius,.55+Math.sin(angle)*radius,z],[.011,.014,.016],[.31+a*.22,.21+a*.17,.065+a*.045],2,5,4);
    }
    }
    // Curved stem, built as a tube.
    surface((u,v)=>{const y=lerp(-2.25,.52,u),r=.021+.012*(1-u),x=Math.sin(u*Math.PI)*.115;return [x+Math.cos(v*TAU)*r,y,-.09+Math.sin(v*TAU)*r];},(u,v)=>[.18+Math.cos(v*TAU)*.025,.255+u*.075,.105],32,9,0);
    // Botanical leaves fold away from the stem in depth.
    [[-.9,-1,.86],[-1.4,1,.77],[-.28,1,.52]].forEach(([base,flip,size])=>{
      surface((u,v)=>{const s=v*2-1,taper=Math.sin(u*Math.PI),x=.1+flip*u*size;return [x,base+u*.42+s*.24*taper,-.1+.25*Math.sin(u*Math.PI)-s*s*.1*taper];},(u,v)=>[.18+u*.12,.26+u*.16,.1+u*.065],20,8,0);
    });
    // Small green sepals behind the flower.
    for(let i=0;i<8;i++){
      const a=i/8*TAU;
      surface((u,v)=>{const r=.12+.44*u,s=(v*2-1)*.085*Math.sin(u*Math.PI);return [Math.cos(a)*r-Math.sin(a)*s,.55+Math.sin(a)*r+Math.cos(a)*s,-.08-.19*u];},()=>[.25,.33,.12],9,4,0);
    }
    return new Float32Array(vertices);
  }

  function makeWebGL(){
    const gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:false,powerPreference:'low-power'});
    if(!gl)return null;
    function program(vertex,fragment){
      function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;}
      const p=gl.createProgram(),v=shader(gl.VERTEX_SHADER,vertex),f=shader(gl.FRAGMENT_SHADER,fragment);gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);gl.deleteShader(v);gl.deleteShader(f);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));return p;
    }
    const flowerProgram=program(`
      precision highp float;
      attribute vec3 aPosition;attribute vec3 aNormal;attribute vec3 aColor;attribute float aPart;
      uniform mat4 uModel;uniform mat4 uView;uniform mat4 uProjection;
      uniform float uBloom;uniform float uGrow;
      varying vec3 vNormal;varying vec3 vPosition;varying vec3 vColor;varying float vPart;
      void main(){
        vec3 p=aPosition;vec3 n=aNormal;
        if(aPart>0.5&&aPart<1.5){
          vec2 radial=vec2(p.x,p.y-0.55);float r=length(radial);
          float opening=0.15+0.85*uBloom;
          p.xy=radial*opening+vec2(0.,0.55);
          p.z+=(1.-uBloom)*r*.92;
          n=normalize(vec3((n.xy-(1.-uBloom)*.92*radial/max(r,.001)*n.z)/opening,n.z));
        }
        if(aPart>1.5&&aPart<2.5){p=vec3(0.,.55,0.)+(p-vec3(0.,.55,0.))*(.65+.35*uBloom);}
        if(aPart>2.5){p.xy=vec2(0.,.55)+(p.xy-vec2(0.,.55))*(.7+.3*uBloom);}
        if(aPart<.5){p.y=.55+(p.y-.55)*uGrow;}
        vec4 world=uModel*vec4(p,1.);vPosition=world.xyz;vNormal=mat3(uModel)*n;vColor=aColor;vPart=aPart;
        gl_Position=uProjection*uView*world;
      }`, `
      precision mediump float;
      uniform vec3 uEye;
      varying vec3 vNormal;varying vec3 vPosition;varying vec3 vColor;varying float vPart;
      void main(){
        vec3 n=normalize(vNormal);if(!gl_FrontFacing)n=-n;
        vec3 view=normalize(uEye-vPosition);
        vec3 light=normalize(vec3(-2.6,4.8,5.0)-vPosition);
        vec3 back=normalize(vec3(2.5,2.0,-3.)-vPosition);
        float diffuse=max(dot(n,light),0.);
        float rim=pow(1.-max(dot(n,view),0.),3.);
        float shine=pow(max(dot(n,normalize(light+view)),0.),38.);
        float transmission=pow(max(dot(-n,light),0.),1.5);
        vec3 color=vColor*(.26+diffuse*.95+max(n.y,0.)*.14);
        if(vPart>.5&&vPart<1.5)color+=vColor*transmission*.5;
        color+=vec3(1.,.82,.4)*shine*.27;
        color+=vec3(.65,.56,.27)*rim*.21*max(dot(n,back),.2);
        color=pow(color,vec3(.84));
        gl_FragColor=vec4(color,1.);
      }`);
    const pointProgram=program(`
      precision highp float;attribute vec3 aPosition;attribute float aSize;
      uniform mat4 uView;uniform mat4 uProjection;uniform float uTime;uniform float uDpr;
      varying float vAlpha;
      void main(){vec3 p=aPosition;p.x+=sin(uTime*.15+aPosition.y)*.17;p.y+=sin(uTime*.13+aPosition.x)*.12;vec4 eye=uView*vec4(p,1.);gl_Position=uProjection*eye;gl_PointSize=clamp(aSize*uDpr*9./(-eye.z),1.,7.);vAlpha=.2+.25*(sin(uTime*.4+aPosition.z)+1.);}
    `,`precision mediump float;varying float vAlpha;void main(){float d=length(gl_PointCoord-.5)*2.;if(d>1.)discard;gl_FragColor=vec4(1.,.81,.39,(1.-d*d)*vAlpha);}`);
    const geometry=createGeometry();
    const mesh=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,mesh);gl.bufferData(gl.ARRAY_BUFFER,geometry,gl.STATIC_DRAW);
    const roseGeometry=createGeometry('rose');
    const roseMesh=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,roseMesh);gl.bufferData(gl.ARRAY_BUFFER,roseGeometry,gl.STATIC_DRAW);
    const particleData=new Float32Array(160*4);
    let seed=821;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
    for(let i=0;i<160;i++)particleData.set([(random()-.5)*13,(random()-.5)*10,(random()-.5)*7,random()*2+.6],i*4);
    const particleBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,particleBuffer);gl.bufferData(gl.ARRAY_BUFFER,particleData,gl.STATIC_DRAW);
    function uniforms(p,names){return Object.fromEntries(names.map(name=>[name,gl.getUniformLocation(p,name)]));}
    const u=uniforms(flowerProgram,['uModel','uView','uProjection','uBloom','uGrow','uEye']);
    const pu=uniforms(pointProgram,['uView','uProjection','uTime','uDpr']);
    const attributes=[['aPosition',3,0],['aNormal',3,12],['aColor',3,24],['aPart',1,36]].map(([name,size,offset])=>({location:gl.getAttribLocation(flowerProgram,name),size,offset}));
    const pa=gl.getAttribLocation(pointProgram,'aPosition'),ps=gl.getAttribLocation(pointProgram,'aSize');
    const maxAttributes=gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
    function resetAttributes(){for(let i=0;i<maxAttributes;i++)gl.disableVertexAttribArray(i);}
    gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.clearColor(0,0,0,0);
    canvas.dataset.renderer='webgl';canvas.dataset.vertices=String(geometry.length/10);
    return {
      resize(){gl.viewport(0,0,canvas.width,canvas.height);},
      draw(state){
        const {model,view,projection,eye,bloom,grow,t}=state;
        gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
        if(useFlowerSprite) return;
        gl.disable(gl.BLEND);gl.depthMask(true);
        gl.useProgram(flowerProgram);resetAttributes();gl.bindBuffer(gl.ARRAY_BUFFER,mesh);
        attributes.forEach(a=>{gl.enableVertexAttribArray(a.location);gl.vertexAttribPointer(a.location,a.size,gl.FLOAT,false,40,a.offset);});
        gl.uniformMatrix4fv(u.uModel,false,model);gl.uniformMatrix4fv(u.uView,false,view);gl.uniformMatrix4fv(u.uProjection,false,projection);gl.uniform3fv(u.uEye,eye);gl.uniform1f(u.uBloom,bloom);gl.uniform1f(u.uGrow,grow);
        if(state.sunflowerReveal>.001)gl.drawArrays(gl.TRIANGLES,0,geometry.length/10);
        gl.bindBuffer(gl.ARRAY_BUFFER,roseMesh);
        attributes.forEach(a=>gl.vertexAttribPointer(a.location,a.size,gl.FLOAT,false,40,a.offset));
        for(const rose of state.roses){
          if(rose.scale<.001)continue;
          gl.uniformMatrix4fv(u.uModel,false,rose.model);gl.uniform1f(u.uBloom,rose.opening);gl.uniform1f(u.uGrow,1);
          gl.drawArrays(gl.TRIANGLES,0,roseGeometry.length/10);
        }
        gl.useProgram(pointProgram);resetAttributes();gl.bindBuffer(gl.ARRAY_BUFFER,particleBuffer);
        gl.enableVertexAttribArray(pa);gl.vertexAttribPointer(pa,3,gl.FLOAT,false,16,0);gl.enableVertexAttribArray(ps);gl.vertexAttribPointer(ps,1,gl.FLOAT,false,16,12);
        gl.uniformMatrix4fv(pu.uView,false,view);gl.uniformMatrix4fv(pu.uProjection,false,projection);gl.uniform1f(pu.uTime,t);gl.uniform1f(pu.uDpr,pixelRatio);
        gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE);gl.depthMask(false);gl.drawArrays(gl.POINTS,0,160);gl.depthMask(true);gl.disable(gl.BLEND);
      }
    };
  }

  function makeFallback(){
    // A different canvas is needed if a WebGL context had already been allocated.
    const flat=document.createElement('canvas');flat.setAttribute('aria-hidden','true');flat.style.cssText='position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1';canvas.after(flat);
    const ctx=flat.getContext('2d');document.querySelector('#fallback-note').hidden=false;canvas.dataset.renderer='canvas-fallback';
    if(!ctx)return {resize(){},draw(){}};
    return {resize(){flat.width=canvas.width;flat.height=canvas.height;ctx.setTransform(pixelRatio,0,0,pixelRatio,0,0);},draw({bloom,t,sunflowerReveal,roses,wind}){
      ctx.clearRect(0,0,width,height);
      if(useFlowerSprite) return;
      const base=Math.min(width*.23,height*.17),r=base*sunflowerReveal,x=width*.5+wind*base*2,y=height*.34+base*2.1*(1-sunflowerReveal);
      [[-1.08,.65,.58],[1.04,.5,.56],[-.55,1.3,.44],[.53,1.22,.46]].forEach(([dx,dy,size],i)=>{
        const reveal=roses[i].opening;if(reveal<.001)return;
        const rx=width*.5+dx*base+wind*base*(i+1)*.6,ry=height*.34+dy*base+base*1.3*(1-reveal),rr=base*size*reveal;
        ctx.strokeStyle='#667e42';ctx.lineWidth=2*reveal;ctx.beginPath();ctx.moveTo(width*.5,height*.34+base*2.6);ctx.quadraticCurveTo(rx,ry+base,rx,ry);ctx.stroke();
        for(let ring=0;ring<4;ring++)for(let petal=0;petal<7;petal++){
          ctx.save();ctx.translate(rx,ry);ctx.rotate(petal/7*TAU+ring*2.4+i*.4);
          const size=rr*(1-ring*.22),tint=ctx.createLinearGradient(0,0,0,-size);
          tint.addColorStop(0,'#956018');tint.addColorStop(1,'#ffe29b');ctx.fillStyle=tint;
          ctx.beginPath();ctx.ellipse(0,-size*.40,size*.52,size*.56,0,0,TAU);ctx.fill();ctx.restore();
        }
      });
      if(sunflowerReveal<.001)return;
      ctx.strokeStyle='#7a8650';ctx.lineWidth=3*sunflowerReveal;ctx.beginPath();ctx.moveTo(x,y);ctx.quadraticCurveTo(x+16,y+r*1.5,width*.5,height*.34+base*2.1);ctx.stroke();ctx.save();ctx.translate(x,y);ctx.rotate(rotation*.2+Math.sin(t*.2)*.025);
      for(let i=0;i<28;i++){ctx.save();ctx.rotate(i/28*TAU);const reach=r*(.3+bloom*.7);const g=ctx.createLinearGradient(0,0,0,-reach);g.addColorStop(0,'#b27219');g.addColorStop(1,'#f7d45f');ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(0,-reach*.58,r*.105,reach*.48,0,0,TAU);ctx.fill();ctx.restore();}
      ctx.fillStyle='#57431e';ctx.beginPath();ctx.arc(0,0,r*.22,0,TAU);ctx.fill();ctx.restore();
    }};
  }

  function initRenderer(){try{renderer=makeWebGL()||makeFallback();}catch(error){console.warn('No fue posible iniciar 3D; se activa la versión ligera.',error.message);renderer=makeFallback();}resize();}
  function resize(){width=innerWidth;height=innerHeight;pixelRatio=Math.min(devicePixelRatio||1,width<700?1.5:1.75);canvas.width=Math.round(width*pixelRatio);canvas.height=Math.round(height*pixelRatio);renderer?.resize();petalRain.resize();updateTarget();dirty=true;schedule();}
  function updateTarget(){const distance=Math.max(1,document.documentElement.scrollHeight-innerHeight);targetProgress=clamp(scrollY/distance);dirty=true;schedule();}
  function sceneState(){
    const p=progress,mobile=width<700,landscape=height<550&&width>height;
    const orbit=smooth(.38,.76,p)*.85-smooth(.78,1,p)*.62;
    const ambient=paused||reduced.matches?0:Math.sin(time*.3)*.025;
    const wind=paused||reduced.matches?0:(Math.sin(time*.64)*.025+Math.sin(time*1.17+.7)*.011);
    const tilt=lerp(-.15,.08,smooth(0,.8,p));
    const group=multiply(rotateY(rotation+orbit+ambient),multiply(rotateX(tilt),rotateZ(-.09)));
    const caress=reduced.matches||time-caressStart>=1.8?0:Math.sin(Math.PI*clamp((time-caressStart)/1.8));
    const breath=1+caress*.035;
    for(let i=0;i<12;i++)group[i]*=breath;
    const sunflowerReveal=smooth(.005,.30,p);
    const stalk=rotateZ(wind);
    for(let i=0;i<12;i++)stalk[i]*=Math.max(.00001,sunflowerReveal);
    stalk[12]=stalk[4]*2.25;stalk[13]=-2.25+stalk[5]*2.25;
    const model=multiply(group,stalk);
    const fullDistance=Math.max(10.6,2.6/(Math.tan(.69/2)*(width/height)*.88));
    let distance=lerp(mobile?9.5:7.5,fullDistance,smooth(.02,.5,p));
    distance-=smooth(.53,.76,p)*.35;
    distance+=smooth(.8,1,p)*.45;
    if(landscape)distance=10.5;
    const eye=[Math.sin(p*1.3)*.18,.55+Math.sin(p*Math.PI)*.3,distance];
    const target=[0,.1,0];
    const projection=perspective(width/height);
    if(landscape){projection[8]=.42;projection[9]=0;}
    else if(mobile)projection[9]=-.25;
    else projection[9]=-.18-.10*smooth(.1,.5,p);
    const roses=[[-1.65,-.53,-.12,.94],[1.57,-.35,-.28,.87],[-.92,-1.35,.50,.66],[.85,-1.23,.63,.70]].map(([x,y,z,size],i)=>{
      const opening=smooth(.08+i*.055,.37+i*.055,p);
      const scale=size*opening;
      const breeze=paused||reduced.matches?0:Math.sin(time*.72+i*1.7)*.028+wind;
      const local=multiply(rotateZ(-Math.sign(x)*.38+breeze),rotateY(-Math.sign(x)*.18));
      for(let j=0;j<12;j++)local[j]*=scale;
      local[12]=x*opening+breeze*scale;local[13]=lerp(-2.25,y,opening);local[14]=z*opening;
      return {model:multiply(group,local),scale,opening};
    });
    return {model,view:lookAt(eye,target),projection,eye:new Float32Array(eye),bloom:.18+.82*smooth(.04,.57,p),grow:1,t:time,caress,roses,sunflowerReveal,wind};
  }
  function updateWords(){
    const position=progress*4;
    const index=clamp(Math.round(position),0,4);
    words.forEach((word,i)=>{
      const distance=Math.abs(position-i);
      const opacity=reduced.matches?(index===i?1:0):1-smooth(.3,.55,distance);
      word.style.opacity=opacity.toFixed(3);
      word.style.visibility=opacity>.001?'visible':'hidden';
      word.style.transform=`translateY(${reduced.matches?0:Math.min(16,distance*24)}px)`;
      word.setAttribute('aria-hidden',String(index!==i));word.inert=index!==i;
    });
    document.documentElement.style.setProperty('--progress',progress.toFixed(4));
    document.dispatchEvent(new CustomEvent('flowers:progress',{detail:{progress,index}}));
    document.querySelector('#progress-fill').style.transform=`scaleX(${progress})`;
    if(active!==index){
      active=index;steps.forEach((step,i)=>{if(i===index)step.setAttribute('aria-current','step');else step.removeAttribute('aria-current');});
      document.querySelector('#scroll-hint').textContent=index===4?'UN DETALLE QUE FLORECE':index===3?'TOCA LA FLOR Y SIENTE LA LUZ':'DESLIZA PARA FLORECER';
      nextButton.textContent=index===4?'↺':'↓';nextButton.setAttribute('aria-label',index===4?'Volver al comienzo':'Avanzar al siguiente momento');
    }
  }
  function render(now){
    animation=0;if(document.hidden||inDialog||contextLost)return;
    const moving=Math.abs(targetProgress-progress)>.00008||Math.abs(wantedRotation-rotation)>.0001;
    if(!dirty&&!moving&&paused)return;
    if(!reduced.matches&&now-frameTime<32){schedule();return;}
    const dt=Math.min(60,now-(previous||now));previous=now;frameTime=now;
    const speed=reduced.matches?1:1-Math.exp(-dt*.009);
    progress=lerp(progress,targetProgress,speed);rotation=lerp(rotation,wantedRotation,speed);
    if(Math.abs(progress-targetProgress)<.00008)progress=targetProgress;
    if(Math.abs(rotation-wantedRotation)<.0001)rotation=wantedRotation;
    if(!paused)time+=dt/1000;
    const state=sceneState();
    updateFlowerAsset(state);
    updateWords();petalRain.draw(state,dt,!paused&&!reduced.matches);renderer?.draw(state);dirty=false;
    if(!paused||moving)schedule();
  }
  function schedule(){if(!animation&&!document.hidden&&!inDialog&&!contextLost)animation=requestAnimationFrame(render);}
  function goTo(index){const distance=document.documentElement.scrollHeight-innerHeight;scrollTo({top:distance*index/4,behavior:reduced.matches?'instant':'smooth'});}
  function syncMotion(){petalRain.resetWind();caressStart=-100;document.body.classList.toggle('paused',paused);dirty=true;schedule();}
  reduced.addEventListener('change',()=>{paused=reduced.matches;syncMotion();updateTarget();});
  steps.forEach(step=>step.addEventListener('click',()=>goTo(Number(step.dataset.step))));
  nextButton.addEventListener('click',()=>goTo(active===4?0:active+1));
  function caressFlower(){
    if(paused||inDialog||contextLost||time-caressStart<1.8)return;
    caressStart=time;petalRain.burst();dirty=true;schedule();
  }
  document.addEventListener('flowers:celebrate',caressFlower);
  document.addEventListener('flowers:dialog',event=>{inDialog=Boolean(event.detail);if(inDialog){cancelAnimationFrame(animation);animation=0;}else{previous=0;dirty=true;schedule();}});
  canvas.addEventListener('pointerdown',event=>{if(event.button!==0||!event.isPrimary)return;drag={id:event.pointerId,x:event.clientX,y:event.clientY,rotation:wantedRotation,started:performance.now(),moved:false};});
  canvas.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.id)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.hypot(dx,dy)>9)drag.moved=true;if(drag.moved&&Math.abs(dx)>Math.abs(dy)*.8){wantedRotation=drag.rotation+dx*.024;dirty=true;schedule();}},{passive:true});
  addEventListener('pointerup',event=>{
    if(!drag||event.pointerId!==drag.id)return;
    if(!drag.moved&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<=9&&performance.now()-drag.started<600&&petalRain.contains(sceneState(),event.clientX,event.clientY))caressFlower();
    drag=null;
  });
  const release=()=>{drag=null;};canvas.addEventListener('pointercancel',release);canvas.addEventListener('pointerleave',release);
  canvas.addEventListener('keydown',event=>{
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();wantedRotation+=event.key==='ArrowLeft'?-.2:.2;dirty=true;schedule();}
    if(event.key==='Enter'||event.key===' '){event.preventDefault();if(!event.repeat)caressFlower();}
  });
  document.querySelector('#open-letter').addEventListener('click',()=>{letter.showModal();inDialog=true;cancelAnimationFrame(animation);animation=0;});
  [document.querySelector('#close-letter'),document.querySelector('#return-flower')].forEach(button=>button.addEventListener('click',()=>letter.close()));
  letter.addEventListener('close',()=>{inDialog=false;previous=0;dirty=true;schedule();});
  letter.addEventListener('click',event=>{if(event.target!==letter)return;const r=letter.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)letter.close();});
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();contextLost=true;cancelAnimationFrame(animation);animation=0;document.querySelector('#fallback-note').textContent='La escena está recuperándose…';document.querySelector('#fallback-note').hidden=false;});
  canvas.addEventListener('webglcontextrestored',()=>{contextLost=false;document.querySelector('#fallback-note').hidden=true;initRenderer();dirty=true;schedule();});
  addEventListener('scroll',updateTarget,{passive:true});addEventListener('resize',resize,{passive:true});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(animation);animation=0;}else{previous=0;dirty=true;schedule();}});
  initRenderer();syncMotion();updateTarget();
})();