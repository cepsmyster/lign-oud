/* Lign: GLSL sources. Everything on screen is computed here. There are no image files. */
window.SH = {};

SH.vs = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos*.5+.5; gl_Position = vec4(aPos,0.,1.); }`;

/* ------------------------------------------------------------------ scene */
SH.scene = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
out vec4 o;

uniform vec2 uRes; uniform float uTime;
uniform vec3 uCam; uniform mat3 uCamM; uniform float uTan; uniform vec2 uShift;
uniform vec2 uBotCS; uniform float uLift; uniform vec3 uLiqN; uniform float uLiqY;
uniform vec4 uBub[2];
uniform vec3 uChip; uniform vec2 uChipCS; uniform float uEmber;
uniform sampler2D uWordA; uniform sampler2D uWordB; uniform sampler2D uLabel; uniform sampler2D uSmoke;
uniform vec4 uRectA; uniform vec4 uRectB; uniform vec2 uWordW; uniform vec2 uWordLod; uniform float uLabLod;
uniform vec3 uKey;
uniform vec3 uSmA; uniform vec3 uSmR; uniform vec3 uSmN; uniform vec2 uSmSize; uniform float uSmAmt;
uniform vec4 uPool;
uniform float uSS; uniform float uEnc; uniform float uBoost;

#define MAXB 10
const float HH=2.9, AM=1.25, AC=1.56, BEV=.17, Y0=.012, RC=.99, RS=1.6, WZ=-7.;
const vec3 CA=vec3(0.,2.15,0.), CB=vec3(0.,1.1,0.);
const float NG=1.5, NO=1.46;
const vec3 SIG=vec3(.09,.44,1.45);
const vec3 GABS=vec3(.035,.022,.030);
const vec3 LB=vec3(-.3786,.7373,-.5593);
const float LBW=.62, LBY0=.80, LBY1=2.10;
const vec2 D8[8]=vec2[8](vec2(1.,0.),vec2(.7071,.7071),vec2(0.,1.),vec2(-.7071,.7071),vec2(-1.,0.),vec2(-.7071,-.7071),vec2(0.,-1.),vec2(.7071,-.7071));

float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float h31(vec3 p){ p=fract(p*.3183099+.1); p*=17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float n3(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.-2.*f);
  return mix(mix(mix(h31(i),h31(i+vec3(1,0,0)),f.x),mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x),mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y),f.z); }
uniform int uZ;
float fbm(vec3 p){ float a=.5,s=0.; for(int i=uZ;i<4;i++){ s+=a*n3(p); p=p*2.03+7.1; a*=.5; } return s; }

vec3 toL(vec3 v){ return vec3(uBotCS.x*v.x-uBotCS.y*v.z, v.y, uBotCS.y*v.x+uBotCS.x*v.z); }
vec3 toW(vec3 v){ return vec3(uBotCS.x*v.x+uBotCS.y*v.z, v.y, -uBotCS.y*v.x+uBotCS.x*v.z); }
vec3 toCd(vec3 v){ return vec3(uChipCS.x*v.x-uChipCS.y*v.z, v.y, uChipCS.y*v.x+uChipCS.x*v.z); }
vec3 toC(vec3 p){ return toCd(p-uChip); }

float fres(float c, float f0){ float x=1.-clamp(c,0.,1.); float x2=x*x; return f0+(1.-f0)*x2*x2*x; }

/* ---- studio: soft boxes on black, described by direction */
float sbox(vec3 d, vec3 c, vec2 hs, float soft){
  float k=dot(d,c); if(k<=0.02) return 0.;
  vec3 r=normalize(cross(vec3(0.,1.,0.),c)); vec3 u=cross(c,r);
  vec2 q=vec2(dot(d,r),dot(d,u))/k;
  vec2 e=smoothstep(hs+soft,hs-soft,abs(q));
  vec2 g=q/hs;
  /* a real softbox is hotter in the middle and toward the top: a flat panel reads as a blank face on the glass */
  return e.x*e.y*(1.-.55*clamp(dot(g,g)*.5,0.,1.))*(.72+.28*clamp(g.y*.5+.5,0.,1.));
}
vec3 env(vec3 d, float rough){
  float s=.05+rough;
  vec3 c=vec3(.018,.014,.011);
  c+=vec3(.20,.125,.065)*uPool.z*smoothstep(.15,1.,-d.z)*smoothstep(-.35,.2,d.y)*smoothstep(1.,.3,d.y);
  c+=vec3(1.,.96,.90)*5.0*sbox(d,uKey,vec2(.30,.52),s+.05);
  c+=vec3(1.,.90,.78)*5.0*sbox(d,vec3(.918,.220,-.330),vec2(.055,.95),s*.6);
  c+=vec3(1.,.93,.84)*7.0*sbox(d,LB,vec2(.20,.30),s);
  c+=vec3(1.,.95,.88)*1.5*smoothstep(.72-s,.985,d.y);
  return c;
}

/* ---- the bottle: a convex body of 26 planes */
#define PL(n,d) { float dn=dot(n,rd), ds=(d)-dot(n,ro); if(dn>1e-6){ float tt=ds/dn; if(tt<tF){ tF=tt; nF=n; } } else if(dn<-1e-6){ float tt=ds/dn; if(tt>tN){ tN=tt; nN=n; } } else if(ds<0.) return false; }
bool hull(vec3 ro, vec3 rd, out float tN, out float tF, out vec3 nN, out vec3 nF){
  tN=-1e9; tF=1e9; nN=vec3(0.,1.,0.); nF=vec3(0.,1.,0.);
  PL(vec3(0.,1.,0.),HH)
  PL(vec3(0.,-1.,0.),-Y0)
  for(int i=uZ;i<8;i++){
    vec2 c=D8[i]; float ap=(i&1)==0?AM:AC;
    PL(vec3(c.x,0.,c.y),ap)
    PL(vec3(c.x*.7071,.7071,c.y*.7071),(ap+HH-BEV)*.7071)
    PL(vec3(c.x*.7071,-.7071,c.y*.7071),(ap-Y0-BEV)*.7071)
  }
  return tN<tF && tF>0.;
}
/* the hollow: a cylinder closed by two spheres */
bool cav(vec3 ro, vec3 rd, out float tN, out float tF, out vec3 nN, out vec3 nF){
  tN=-1e9; tF=1e9; nN=vec3(0.,1.,0.); nF=vec3(0.,1.,0.);
  int iN=0, iF=0;
  float a=dot(rd.xz,rd.xz), b=dot(ro.xz,rd.xz), c=dot(ro.xz,ro.xz)-RC*RC;
  if(a<1e-8){ if(c>0.) return false; }
  else { float h=b*b-a*c; if(h<0.) return false; h=sqrt(h); tN=(-b-h)/a; tF=(-b+h)/a; }
  vec3 oc=ro-CA; float b2=dot(oc,rd), h2=b2*b2-dot(oc,oc)+RS*RS; if(h2<0.) return false; h2=sqrt(h2);
  if(-b2-h2>tN){ tN=-b2-h2; iN=1; } if(-b2+h2<tF){ tF=-b2+h2; iF=1; }
  oc=ro-CB; b2=dot(oc,rd); h2=b2*b2-dot(oc,oc)+RS*RS; if(h2<0.) return false; h2=sqrt(h2);
  if(-b2-h2>tN){ tN=-b2-h2; iN=2; } if(-b2+h2<tF){ tF=-b2+h2; iF=2; }
  if(tN>=tF) return false;
  vec3 p=ro+rd*tN; nN = iN==0 ? vec3(p.x,0.,p.z)/RC : (iN==1 ? (p-CA)/RS : (p-CB)/RS);
  p=ro+rd*tF;      nF = iF==0 ? vec3(p.x,0.,p.z)/RC : (iF==1 ? (p-CA)/RS : (p-CB)/RS);
  return true;
}
bool cyl(vec3 ro, vec3 rd, float r, float y0, float y1, out float t, out vec3 n){
  t=1e9; n=vec3(0.,1.,0.);
  float a=dot(rd.xz,rd.xz), b=dot(ro.xz,rd.xz), c=dot(ro.xz,ro.xz)-r*r;
  if(a>1e-8){ float h=b*b-a*c; if(h>0.){ float ts=(-b-sqrt(h))/a; float y=ro.y+rd.y*ts;
    if(ts>1e-4 && y>y0 && y<y1){ t=ts; vec2 q=(ro.xz+rd.xz*ts)/r; n=vec3(q.x,0.,q.y); } } }
  if(rd.y<-1e-6){ float tt=(y1-ro.y)/rd.y; vec2 q=ro.xz+rd.xz*tt; if(tt>1e-4 && tt<t && dot(q,q)<r*r){ t=tt; n=vec3(0.,1.,0.); } }
  if(rd.y>1e-6){ float tt=(y0-ro.y)/rd.y; vec2 q=ro.xz+rd.xz*tt; if(tt>1e-4 && tt<t && dot(q,q)<r*r){ t=tt; n=vec3(0.,-1.,0.); } }
  return t<1e8;
}
/* n faces the ray. true when the ray passes through */
bool iface(inout vec3 d, vec3 n, float n1, float n2, inout vec3 thr){
  float eta=n1/n2; float c=-dot(d,n); float k=1.-eta*eta*(1.-c*c);
  if(k<0.){ d=reflect(d,n); return false; }
  float ct=sqrt(k);
  float f0=(n1-n2)/(n1+n2); f0*=f0;
  thr*=1.-fres(n1>n2?ct:c,f0);
  d=normalize(eta*d+(eta*c-ct)*n);
  return true;
}

/* ---- wall with the gilded word */
float wA(vec2 q, float lod){ vec2 uv=(q-uRectA.xy)/uRectA.zw*.5+.5; if(uv.x<0.||uv.x>1.||uv.y<0.||uv.y>1.) return 0.; return textureLod(uWordA,uv,uWordLod.x+lod).r; }
float wB(vec2 q, float lod){ vec2 uv=(q-uRectB.xy)/uRectB.zw*.5+.5; if(uv.x<0.||uv.x>1.||uv.y<0.||uv.y>1.) return 0.; return textureLod(uWordB,uv,uWordLod.y+lod).r; }
float wordAt(vec2 q, float lod){ float a=0.; if(uWordW.x>.004) a+=wA(q,lod)*uWordW.x; if(uWordW.y>.004) a+=wB(q,lod)*uWordW.y; return a; }
vec3 wall(vec3 p, vec3 rd){
  vec2 q=p.xy;
  vec2 dq=(q-uPool.xy)*vec2(.118,.155)*uPool.w;
  float r2=dot(dq,dq);
  float pool=(.86*exp(-r2*4.2)+.14*exp(-r2*.7))*uPool.z;
  float gr=fbm(vec3(q*1.3,3.))-.5;
  float fine=n3(vec3(q*vec2(9.,34.),5.))-.5;
  vec3 base=vec3(.007,.0055,.0045)*(1.+gr*.6)+vec3(.58,.33,.14)*pool*(.46+.16*gr+.05*fine);
  base*=smoothstep(-.4,2.2,p.y)*.7+.3;
  float al=wordAt(q,0.);
  if(al>.003){
    float e=.05;
    float ax=wordAt(q+vec2(e,e),1.)-wordAt(q-vec2(e,e),1.);
    float leaf=fbm(vec3(q*2.6,9.));
    vec2 cq=q*1.15; vec2 ci=floor(cq);
    float sq=h21(ci)*.5+.5*h21(ci+7.);
    float seam=smoothstep(.0,.03,min(fract(cq.x),fract(cq.y)));
    float sheen=.5+.5*sin(q.x*.5+q.y*.8+leaf*2.6+rd.x*7.+sq*2.);
    vec3 g=vec3(1.,.66,.25);
    vec3 gc=g*(.035+.50*pool*(.75+.5*sq)+.22*pool*sheen*sheen+.05*sheen)*(.8+.4*leaf)*(.86+.14*seam);
    gc+=vec3(1.,.86,.6)*max(-ax,0.)*(.10+.9*pool);
    gc+=vec3(1.,.9,.7)*pow(sheen,12.)*.10*(.3+pool);
    base=mix(base,gc,clamp(al,0.,1.));
    base*=1.-.45*max(ax,0.)*(1.-al);
  }
  return base;
}

/* ---- ground: black polished stone. The back light throws the shadow of the bottle and its amber caustic forward */
vec3 ground(vec3 p){
  vec2 c=p.xz-vec2(.9,.4);
  float spot=exp(-dot(c,c)/30.);
  float sp=h21(floor(p.xz*110.));
  vec3 alb=vec3(.040,.035,.031)*(.8+.4*n3(vec3(p.xz*2.2,1.)))+vec3(.03,.026,.02)*step(.992,sp);
  vec3 lf=vec3(1.);
  vec3 lo=toL(p), ld=toL(LB);
  float tN,tF; vec3 nN,nF;
  if(hull(lo,ld,tN,tF,nN,nF)){
    float gap=tF-max(tN,0.);
    float k=smoothstep(0.,.45,gap);
    vec2 lh=normalize(LB.xz);
    float d=-dot(p.xz,lh);
    float s=dot(p.xz,vec2(-lh.y,lh.x));
    float hAx=d*LB.y/length(LB.xz);
    float foc=1.-d/1.72;
    float af=max(abs(foc),.2);
    float s0=s/(foc<0.?-af:af);
    float wl=smoothstep(.5,.85,hAx)*smoothstep(2.5,2.2,hAx);
    float inl=smoothstep(RC,RC*.82,abs(s0))*wl;
    float chord=2.*sqrt(max(RC*RC-s0*s0,0.));
    vec3 Tl=exp(-SIG*chord*1.0)*(2.1/af);
    float bands=0.;
    vec2 pr=vec2(-ld.z,ld.x); pr/=max(length(pr),1e-4);
    for(int i=uZ;i<8;i++){
      vec2 v=D8[i]*((i&1)==0?1.30:1.52);
      float e=dot(v,pr)*(1.-d/3.4);
      float w=(s-e)/(.03+.05*d);
      bands+=exp(-w*w);
    }
    vec3 thru=mix(vec3(.30,.31,.30)*(1.+.9*bands), Tl*(1.+.55*bands), inl);
    thru+=vec3(.55,.58,.6)*smoothstep(.55,.2,hAx)*smoothstep(1.25,.5,abs(s))*(.6+bands);
    lf=mix(vec3(1.),thru,k);
  }
  /* cap and collar */
  { float a=dot(ld.xz,ld.xz); float tc=-dot(lo.xz,ld.xz)/a; float dc=length(lo.xz+ld.xz*tc); float yc=lo.y+ld.y*tc;
    float capB=3.36+uLift;
    float cs=smoothstep(.72,.5,dc)*smoothstep(capB-.1,capB+.1,yc)*smoothstep(capB+1.1,capB+.9,yc);
    cs=max(cs,smoothstep(.6,.4,dc)*smoothstep(2.8,2.95,yc)*smoothstep(3.46,3.3,yc));
    lf*=1.-cs*step(0.,tc); }
  /* chip: contact shadow and the glow of the ember */
  vec3 cl=toC(p);
  float csh=1.-.82*exp(-(pow((cl.x+.28)/.62,2.)+pow(cl.z/.27,2.)));
  float dr=length(p.xz);
  float ao=1.-.55*smoothstep(2.1,1.3,dr);
  vec3 col=alb*(vec3(.05)+vec3(1.,.94,.86)*2.1*spot*LB.y*lf*csh*ao);
  vec3 de=p-vec3(uSmA.x,.42,uSmA.z);
  col+=alb*vec3(1.,.30,.05)*uEmber*3.2/(dot(de,de)+.05);
  return col;
}

/* ---- agarwood chip, by distance field, in its own frame */
float chipD(vec3 p){
  float u=clamp(p.x/.8,-1.,1.);
  float v=u*.5+.5;
  float yc=.105+.27*v*v;
  vec3 q=p-vec3(0.,yc,.06*sin(u*2.6+1.));
  float tw=.22*u+.18; float c=cos(tw), s=sin(tw); q.yz=mat2(c,-s,s,c)*q.yz;
  float wz=.27*(1.-.42*u*u)+.04*sin(u*7.+2.);
  float wy=.082*(1.-.22*u)*(.45+.55*smoothstep(-1.1,.5,q.z/.27));
  float len=.8-.22*n3(vec3(q.z*10.,q.y*13.,p.x>0.?3.:8.));
  vec3 b=abs(q)-vec3(len,wy,wz);
  float d=length(max(b,0.))+min(max(b.x,max(b.y,b.z)),0.)-.008;
  if(d>.14) return d-.06;
  d+=(abs(n3(vec3(p.x*1.1,q.y*19.,q.z*19.))-.5)*2.-.45)*.030;
  d+=(n3(vec3(p.x*2.6,q.y*58.,q.z*58.)+4.)-.5)*.013;
  d+=(fbm(vec3(p.x*1.7,q.y*6.,q.z*6.)+3.)-.5)*.050;
  return d*.6;
}
/* the march and the four normal taps share one loop, so the field is compiled once */
float chipHit(vec3 ro, vec3 rd, float tmax, out vec3 cp, out vec3 cn){
  cp=vec3(0.); cn=vec3(0.,1.,0.);
  vec3 o2=toC(ro), d=toCd(rd);
  vec3 oc=o2-vec3(0.,.3,0.);
  float b=dot(oc,d), h=b*b-dot(oc,oc)+1.0;
  if(h<0.) return -1.;
  h=sqrt(h); float t=max(-b-h,0.), te=min(-b+h,tmax);
  if(t>=te) return -1.;
  vec2 e=vec2(.0025,-.0025);
  vec3 g=vec3(0.); int k=-1;
  for(int i=uZ;i<80;i++){
    vec3 ee=k<=0?e.xyy:(k==1?e.yyx:(k==2?e.yxy:e.xxx));
    vec3 p=k<0?o2+d*t:cp+ee;
    float s=chipD(p);
    if(k<0){
      if(s<.0012){ cp=p; k=0; }
      else { t+=s; if(t>te) break; }
    } else { g+=ee*s; k++; if(k>3) break; }
  }
  if(k<1) return -1.;
  cn=normalize(g);
  return t;
}
vec3 chipShade(vec3 p, vec3 n, vec3 rdw){
  vec3 rd=toCd(rdw);
  float u=p.x/.8;
  float fib=n3(vec3(p.x*1.6,p.y*26.,p.z*26.));
  float streak=smoothstep(.70,.92,n3(vec3(p.x*2.,p.y*40.,p.z*40.)+5.));
  float res=smoothstep(.34,.60,fbm(vec3(p.x*1.2,p.y*7.,p.z*7.)+11.));
  float b1=n3(vec3(p.x*3.,p.y*95.,p.z*95.)), b2=n3(vec3(p.x*3.,p.y*95.,p.z*95.)+17.);
  n=normalize(n+vec3(0.,b1-.5,b2-.5)*.8);
  vec3 wood=mix(vec3(.135,.084,.048),vec3(.036,.022,.013),fib);
  wood=mix(wood,vec3(.29,.21,.13),streak*.45);
  wood*=.75+.5*b1;
  vec3 alb=mix(wood,vec3(.012,.008,.005),res*.94);
  vec3 lk=toCd(uKey), lb=toCd(LB);
  float ao=.5+.5*smoothstep(.35,.62,fib*.6+n3(vec3(p.x*1.1,p.y*21.,p.z*21.))*.5);
  float gnd=smoothstep(-.05,.35,p.y+n.y*.2);
  vec3 c=alb*(vec3(.05,.045,.04)+1.9*max(dot(n,lk),0.)*vec3(1.,.95,.88)+2.5*max(dot(n,lb),0.)*vec3(1.,.92,.82)+.25*max(-n.y,0.)*vec3(.3,.25,.2))*ao*gnd;
  float gl=.015+.30*res;
  vec3 h1=normalize(lk-rd), h2=normalize(lb-rd);
  c+=gl*(pow(max(dot(n,h1),0.),90.)*2.0+pow(max(dot(n,h2),0.),70.)*2.4)*vec3(1.,.9,.76)*ao;
  c+=alb*fres(dot(n,-rd),0.)*.22*vec3(1.,.85,.7)*max(dot(n,lb)+.3,0.);
  float edge=u+(n3(p*13.)-.5)*.14;
  float eb=smoothstep(.70,.82,edge);
  float ash=smoothstep(.54,.68,edge)*(1.-eb);
  c=mix(c,vec3(.26,.25,.24)*(.2+1.4*max(dot(n,lb),0.)+.7*max(dot(n,lk),0.))*(.6+.6*fib),ash*.8);
  float hot=.55*n3(p*23.+vec3(0.,uTime*.5,0.))+.45*n3(p*8.-vec3(uTime*.22,0.,0.));
  float crack=smoothstep(.35,.75,n3(p*38.));
  vec3 em=vec3(1.,.24,.03)*(.9+5.5*hot*hot)*(.35+.65*crack)+vec3(1.,.62,.22)*pow(hot,5.)*9.;
  c=mix(c,em*uEmber+vec3(.05,.03,.025)*(1.-uEmber),eb);
  vec3 E=vec3(.74,.44,0.); float d2=dot(p-E,p-E);
  c+=alb*vec3(1.,.30,.05)*uEmber*.25/(d2+.015)*(1.-eb);
  return c;
}

/* ---- smoke: a simulated sheet that always faces the lens */
void smoke(vec3 ro, vec3 rd, float tmax, inout vec3 col, inout vec3 thr){
  if(uSmAmt<.004) return;
  float dn=dot(rd,uSmN); if(abs(dn)<1e-4) return;
  float t=dot(uSmA-ro,uSmN)/dn; if(t<=0.||t>=tmax) return;
  vec3 p=ro+rd*t-uSmA;
  vec2 uv=vec2(dot(p,uSmR)/uSmSize.x+.5,p.y/uSmSize.y);
  if(uv.x<=0.||uv.x>=1.||uv.y<=0.||uv.y>=1.) return;
  float d=textureLod(uSmoke,uv,0.).r;
  if(d<.003) return;
  float d2=textureLod(uSmoke,uv+vec2(-.010,.012),0.).r+textureLod(uSmoke,uv+vec2(-.024,.030),0.).r+textureLod(uSmoke,uv+vec2(-.045,.055),0.).r;
  float a=(1.-exp(-d*1.25))*uSmAmt*mix(1.,.45,smoothstep(.25,.95,uv.y));
  vec3 c=vec3(.86,.83,.80)*(.16+1.25*exp(-d2*.85));
  vec3 e=ro+rd*t-vec3(uSmA.x,uSmA.y+uSmSize.y*.035,uSmA.z);
  c+=vec3(1.,.36,.08)*uEmber*.55/(1.+dot(e,e)*16.);
  col+=thr*c*a; thr*=1.-a;
}

/* ---- glass rod under the cap, and the thread of oil that follows it out */
void thin(vec3 lo, vec3 ld, float tmax, float tipY, float capB, inout vec3 col, inout vec3 thr){
  if(uLift<.03) return;
  float a=dot(ld.xz,ld.xz); if(a<1e-6) return;
  float tc=-dot(lo.xz,ld.xz)/a; if(tc<=0.||tc>=tmax) return;
  vec2 cx=lo.xz+ld.xz*tc;
  float d=length(cx); float y=lo.y+ld.y*tc;
  if(y<3.36||y>capB||d>.14) return;
  float r, oil;
  if(y>tipY){
    oil=smoothstep(tipY+.75,tipY+.05,y);
    r=.05+.014*oil+.022*exp(-pow((y-tipY)/.07,2.));
  } else {
    float len=max(tipY-3.36,1e-3); float k=(y-3.36)/len;
    r=.013+.040*k*k*k; oil=1.;
    float by=tipY-fract(uTime*.085)*len;
    r+=.030*exp(-pow((y-by)/.075,2.))*smoothstep(0.,.15,(tipY-by)/len);
    r*=smoothstep(0.,.25,len);
  }
  if(d>=r) return;
  float x=d/r; float z=sqrt(1.-x*x);
  float cov=smoothstep(1.,.72,x);
  vec2 side=cx/max(d,1e-5); vec2 fw=-ld.xz/sqrt(a);
  vec3 n=vec3(side.x*x+fw.x*z,0.,side.y*x+fw.y*z);
  vec3 wn=toW(n), wrd=toW(ld);
  float F=fres(z,.04);
  vec3 tint=mix(vec3(.90,.93,.92),exp(-SIG*r*z*30.),oil);
  /* a cylinder turns the scene over. Stand in for that with a bright core and dark flanks */
  float core=smoothstep(.85,.0,x);
  vec3 lens=mix(vec3(.22),vec3(1.5),core);
  col+=thr*cov*(F*env(reflect(wrd,wn),0.)+tint*lens*vec3(.5,.34,.17)*.5*oil*uPool.z);
  thr*=mix(vec3(1.),tint*(1.-F)*mix(vec3(.45+.55*core),lens*.6,oil),cov);
}

vec3 labelShade(vec3 lp, vec3 ld){
  vec2 uv=vec2((lp.x+LBW)/(2.*LBW),(lp.y-LBY0)/(LBY1-LBY0));
  vec4 tx=textureLod(uLabel,uv,uLabLod);
  float e=1.6/1024.;
  float hx=textureLod(uLabel,uv+vec2(e,0.),uLabLod).a-textureLod(uLabel,uv-vec2(e,0.),uLabLod).a;
  float hy=textureLod(uLabel,uv+vec2(0.,e),uLabLod).a-textureLod(uLabel,uv-vec2(0.,e),uLabLod).a;
  vec3 n=normalize(vec3(-hx*2.2,-hy*2.2,1.));
  vec3 lk=toL(uKey);
  float dif=max(dot(n,lk),0.);
  float fib=n3(vec3(uv*vec2(260.,300.),1.))*.05+n3(vec3(uv*36.,2.))*.05;
  vec2 ed=min(uv,1.-uv);
  float edge=smoothstep(0.,.012,min(ed.x,ed.y));
  vec3 c=tx.rgb*(1.-fib)*(vec3(.07,.058,.045)+dif*vec3(1.,.95,.87)*.76+vec3(.09,.058,.03)*uPool.z);
  vec3 h=normalize(lk-ld);
  c+=vec3(1.,.8,.45)*pow(max(dot(n,h),0.),30.)*.25*(1.-tx.a);
  return c*(.75+.25*edge);
}
vec3 goldShade(vec3 lp, vec3 ln, vec3 ld, int which, float capB){
  vec3 n=ln; float occ=1.; float rough=.03;
  if(which==4){
    if(ln.y>.5){ float rr=length(lp.xz); if(rr<.2) return vec3(.003); occ=.5+.5*smoothstep(.2,.3,rr); rough=.1; }
    else { float yb=lp.y-HH; float gv=smoothstep(.02,.0,abs(yb-.10))+smoothstep(.02,.0,abs(yb-.36)); occ=1.-.7*gv; }
  } else {
    if(abs(ln.y)<.5){
      float yb=lp.y-capB;
      float band=smoothstep(.10,.125,yb)*smoothstep(.88,.855,yb);
      float th=atan(lp.z,lp.x); float f=fract(th*44./6.2831853);
      float dl=(f-.5)*1.95*band; float c=cos(dl), s=sin(dl);
      n=vec3(c*ln.x+s*ln.z,0.,-s*ln.x+c*ln.z);
      occ=mix(1.,.30+.70*smoothstep(0.,.2,min(f,1.-f)),band);
      float lip=smoothstep(.03,.0,abs(yb-.11))+smoothstep(.03,.0,abs(yb-.87));
      occ*=1.-.6*lip;
      n=normalize(n+vec3(0.,.9*smoothstep(.93,.98,yb),0.));
    } else if(ln.y>.5){
      float rr=length(lp.xz); rough=.12;
      n=normalize(vec3(lp.x,0.,lp.z)*smoothstep(.5,.62,rr)*1.2+vec3(0.,1.,0.));
      occ=.8+.2*sin(rr*150.);
    }
  }
  vec3 wn=toW(n), wrd=toW(ld);
  vec3 r=reflect(wrd,wn);
  vec3 e=env(r,rough);
  float fz=fres(dot(-wrd,wn),0.);
  vec3 F=mix(vec3(1.,.70,.29),vec3(1.,.93,.82),fz);
  return (e*F+vec3(1.,.70,.29)*.010)*occ;
}

vec3 trace(vec3 ro, vec3 rd){
  vec3 col=vec3(0.), thr=vec3(1.);
  int med=0; int bi=0; float via=0.;
  float capB=3.36+uLift;
  float tipY=capB-1.2;
  vec3 pl0=vec3(0.,uLiqY,0.);
  for(int i=uZ;i<MAXB;i++){
    vec3 lo=toL(ro), ld=toL(rd);
    float tN,tF; vec3 nN,nF;
    if(med==0){
      float t=1e9; int hit=0; vec3 n=vec3(0.,1.,0.);
      if(rd.y<-1e-5){ t=-ro.y/rd.y; hit=1; }
      if(rd.z<-1e-5){ float tw=(WZ-ro.z)/rd.z; if(tw<t){ t=tw; hit=2; } }
      if(hull(lo,ld,tN,tF,nN,nF) && tN>1e-3 && tN<t){ t=tN; hit=3; n=nN; }
      float tc; vec3 nc;
      if(cyl(lo,ld,.5,HH-.02,3.36,tc,nc) && tc<t){ t=tc; hit=4; n=nc; }
      if(cyl(lo,ld,.62,capB,capB+.98,tc,nc) && tc<t){ t=tc; hit=5; n=nc; }
      vec3 cp, cn;
      float tch=chipHit(ro,rd,t,cp,cn);
      if(tch>0.){ t=tch; hit=6; }
      thin(lo,ld,t,tipY,capB,col,thr);
      smoke(ro,rd,t,col,thr);
      if(hit==0){ col+=thr*env(rd,.1)*.5; break; }
      vec3 p=ro+rd*t;
      if(hit==1){
        float F=fres(-rd.y,.045);
        float fade=exp(-max(length(p.xz)-5.,0.)*.11);
        col+=thr*ground(p)*(1.-F);
        thr*=F*fade*vec3(.96,.94,.91);
        if(max(thr.r,max(thr.g,thr.b))<.004) break;
        vec2 w=vec2(n3(vec3(p.xz*4.,0.)),n3(vec3(p.xz*4.,7.)))-.5;
        rd=reflect(rd,normalize(vec3(w.x*.010,1.,w.y*.010)));
        if(rd.y<1e-3) rd.y=1e-3;
        ro=p+vec3(0.,1e-4,0.);
        continue;
      }
      if(hit==2){ col+=thr*wall(p,rd)*(1.+via*uBoost); break; }
      if(hit==3){
        vec3 lp=lo+ld*t;
        if(n.z>.99 && abs(lp.x)<LBW && lp.y>LBY0 && lp.y<LBY1){ col+=thr*labelShade(lp,ld); break; }
        vec3 wn=toW(n);
        float F=fres(-dot(rd,wn),.04);
        /* no polished face is perfectly flat: a faint wave keeps a facet from flashing as one blank panel */
        vec3 wv=vec3(n3(lp*1.9),n3(lp*1.9+5.),n3(lp*1.9+9.))-.5;
        col+=thr*F*env(reflect(rd,normalize(wn+wv*.045)),0.);
        thr*=1.-F;
        rd=refract(rd,wn,1./NG); ro=p; med=1;
        continue;
      }
      if(hit==4||hit==5){ col+=thr*goldShade(lo+ld*t,n,ld,hit,capB); break; }
      col+=thr*chipShade(cp,cn,rd); break;
    }
    if(med==1){
      if(!hull(lo,ld,tN,tF,nN,nF)){ med=0; continue; }
      float cN,cF; vec3 cnN,cnF;
      bool hc=cav(lo,ld,cN,cF,cnN,cnF) && cN>1e-3 && cN<tF;
      float t=hc?cN:max(tF,0.);
      thr*=exp(-GABS*t);
      vec3 lp=lo+ld*t; vec3 d=ld;
      if(hc){
        bool liq=dot(lp-pl0,uLiqN)<0.;
        if(iface(d,cnN,NG,liq?NO:1.,thr)) med=liq?2:3;
      } else {
        if(nF.z>.99 && abs(lp.x)<LBW && lp.y>LBY0 && lp.y<LBY1){
          col+=thr*vec3(.20,.16,.11)*(.25+.9*max(toL(uKey).z,0.)); break; }
        if(nF.y>.99 && dot(lp.xz,lp.xz)<.25){ col+=thr*vec3(.05,.034,.014); break; }
        if(iface(d,-nF,NG,1.,thr)) med=0;
      }
      ro=toW(lp); rd=toW(d); continue;
    }
    if(med==2){
      float cN,cF; vec3 cnN,cnF;
      if(!cav(lo,ld,cN,cF,cnN,cnF)){ med=1; continue; }
      float t=max(cF,0.); int ev=0;
      float dn=dot(ld,uLiqN);
      if(dn>1e-5){ float tp=dot(pl0-lo,uLiqN)/dn; if(tp<t){ t=max(tp,0.); ev=1; } }
      for(int b=0;b<2;b++){
        vec3 oc=lo-uBub[b].xyz; float bb=dot(oc,ld); float h=bb*bb-dot(oc,oc)+uBub[b].w*uBub[b].w;
        if(h>0.){ float tb=-bb-sqrt(h); if(tb>1e-3 && tb<t){ t=tb; ev=2; bi=b; } }
      }
      thr*=exp(-SIG*t); via=1.;
      vec3 lp=lo+ld*t; vec3 d=ld;
      if(ev==0){ if(iface(d,-cnF,NO,NG,thr)) med=1; }
      else if(ev==1){ if(iface(d,-uLiqN,NO,1.,thr)) med=3; }
      else { vec3 bn=(lp-uBub[bi].xyz)/uBub[bi].w; if(iface(d,bn,NO,1.,thr)) med=4; }
      ro=toW(lp); rd=toW(d); continue;
    }
    if(med==3){
      float cN,cF; vec3 cnN,cnF;
      if(!cav(lo,ld,cN,cF,cnN,cnF)){ med=1; continue; }
      float t=max(cF,0.); int ev=0;
      float dn=dot(ld,uLiqN);
      if(dn<-1e-5){ float tp=dot(pl0-lo,uLiqN)/dn; if(tp<t){ t=max(tp,0.); ev=1; } }
      vec3 lp=lo+ld*t; vec3 d=ld;
      if(ev==0){ if(iface(d,-cnF,1.,NG,thr)) med=1; }
      else { if(iface(d,uLiqN,1.,NO,thr)) med=2; }
      ro=toW(lp); rd=toW(d); continue;
    }
    {
      vec3 bc=uBub[bi].xyz; float br=uBub[bi].w;
      vec3 oc=lo-bc; float bb=dot(oc,ld); float h=max(bb*bb-dot(oc,oc)+br*br,0.);
      float t=max(-bb+sqrt(h),0.);
      vec3 lp=lo+ld*t; vec3 d=ld;
      if(iface(d,-(lp-bc)/br,1.,NO,thr)) med=2;
      ro=toW(lp); rd=toW(d);
    }
  }
  if(med!=0) col+=thr*vec3(.10,.055,.018)*uPool.z;
  return col;
}

bool nearB(vec3 ro, vec3 rd){
  float H=4.5+uLift;
  float a=dot(rd.xz,rd.xz), b=dot(ro.xz,rd.xz), c=dot(ro.xz,ro.xz)-3.5;
  float h=b*b-a*c;
  if(h>0. && a>1e-6){ h=sqrt(h); float y0=ro.y+rd.y*(-b-h)/a, y1=ro.y+rd.y*(-b+h)/a; if(min(y0,y1)<H && max(y0,y1)>-H) return true; }
  vec3 cc=uChip+vec3(0.,.3,0.); vec3 oc=ro-cc; float bb=dot(oc,rd); if(bb*bb-dot(oc,oc)+1.05>0.) return true;
  cc.y=-cc.y; oc=ro-cc; bb=dot(oc,rd); if(bb*bb-dot(oc,oc)+1.05>0.) return true;
  return false;
}
vec3 rayDir(vec2 fc){ vec2 ndc=(2.*fc-uRes)/uRes.y+uShift; return normalize(uCamM*vec3(ndc*uTan,1.)); }

void main(){
  vec2 fc=gl_FragCoord.xy;
  vec3 rd0=rayDir(fc);
  int ns=(uSS>.5 && nearB(uCam,rd0))?4:1;
  vec3 tot=vec3(0.);
  for(int s=uZ;s<ns;s++){
    vec2 off=ns==1?vec2(0.):(s==0?vec2(.125,.375):(s==1?vec2(-.375,.125):(s==2?vec2(.375,-.125):vec2(-.125,-.375))));
    tot+=trace(uCam,rayDir(fc+off));
  }
  tot/=float(ns);
  tot=min(tot,vec3(60.));
  o=vec4(uEnc>.5?sqrt(min(tot*.125,1.)):tot,1.);
}`;

/* ------------------------------------------------------------------ post */
SH.bright = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform vec2 uPx; uniform float uThr; uniform float uEnc;
vec3 dec(vec3 c){ return uEnc>.5?c*c*8.:c; }
void main(){
  vec3 c=dec(textureLod(uTex,vUv+uPx*vec2(-1.,-1.),0.).rgb)+dec(textureLod(uTex,vUv+uPx*vec2(1.,-1.),0.).rgb)
        +dec(textureLod(uTex,vUv+uPx*vec2(-1.,1.),0.).rgb)+dec(textureLod(uTex,vUv+uPx*vec2(1.,1.),0.).rgb);
  c*=.25; float l=max(c.r,max(c.g,c.b));
  c*=max(l-uThr,0.)/max(l,1e-4);
  o=vec4(min(c,vec3(24.)),1.);
}`;
SH.blur = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform vec2 uDir;
void main(){
  vec3 c=textureLod(uTex,vUv,0.).rgb*.2270270;
  c+=(textureLod(uTex,vUv+uDir*1.3846,0.).rgb+textureLod(uTex,vUv-uDir*1.3846,0.).rgb)*.3162162;
  c+=(textureLod(uTex,vUv+uDir*3.2308,0.).rgb+textureLod(uTex,vUv-uDir*3.2308,0.).rgb)*.0702703;
  o=vec4(c,1.);
}`;
SH.final = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uTex; uniform sampler2D uB1; uniform sampler2D uB2;
uniform float uTime; uniform float uEnc; uniform float uAspect; uniform float uBloom;
vec3 dec(vec3 c){ return uEnc>.5?c*c*8.:c; }
float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.); }
void main(){
  vec3 c=dec(texture(uTex,vUv).rgb);
  c+=(texture(uB1,vUv).rgb*.16+texture(uB2,vUv).rgb*.26)*uBloom;
  vec2 q=(vUv-.5)*vec2(min(uAspect,1.6)/1.6,1.);
  float v=1.-dot(q,q)*.95; c*=v*v;
  c=aces(c*1.18);
  c=pow(c,vec3(1./2.2));
  float l=dot(c,vec3(.3,.59,.11));
  c=mix(c,c*vec3(1.035,1.,.955),.6);
  c+=vec3(.012,.006,.0)*(1.-l);
  float g=h21(gl_FragCoord.xy+fract(uTime*7.31)*vec2(91.7,53.1))+h21(gl_FragCoord.yx*1.37+fract(uTime*3.17)*37.3)-1.;
  c+=g*(.016+.022*(1.-l));
  o=vec4(c,1.);
}`;

/* ------------------------------------------------------------------ smoke solver, two dimensions */
SH.curl = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uVel; uniform vec2 uPx;
void main(){
  float L=texture(uVel,vUv-vec2(uPx.x,0.)).y, R=texture(uVel,vUv+vec2(uPx.x,0.)).y;
  float B=texture(uVel,vUv-vec2(0.,uPx.y)).x, T=texture(uVel,vUv+vec2(0.,uPx.y)).x;
  o=vec4(.5*(R-L-T+B),0.,0.,1.);
}`;
SH.vel = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uVel; uniform sampler2D uDen; uniform sampler2D uCurl;
uniform vec2 uPx; uniform float uDt; uniform float uTime;
uniform vec4 uPtr; uniform float uPtrOn; uniform float uDraft; uniform vec2 uSrc; uniform float uBurst;
void main(){
  vec2 v=texture(uVel,vUv).xy;
  vec2 nv=texture(uVel,vUv-uDt*(v+vec2(0.,44.))*uPx).xy;
  vec2 dn=texture(uDen,vUv).xy;
  nv.y+=uDt*(250.*dn.y+34.*dn.x);
  float L=abs(texture(uCurl,vUv-vec2(uPx.x,0.)).r), R=abs(texture(uCurl,vUv+vec2(uPx.x,0.)).r);
  float B=abs(texture(uCurl,vUv-vec2(0.,uPx.y)).r), T=abs(texture(uCurl,vUv+vec2(0.,uPx.y)).r);
  float C=texture(uCurl,vUv).r;
  vec2 f=.5*vec2(T-B,R-L); f/=length(f)+1e-4; f*=8.*C; f.y*=-1.;
  nv+=f*uDt;
  float hgt=smoothstep(.10,.55,vUv.y);
  vec2 q=vUv*vec2(1.,1.5);
  nv.x+=uDt*hgt*(16.*sin(q.y*7.+uTime*.43+2.*sin(q.x*5.-uTime*.21))+9.*sin(q.y*17.-uTime*.9+q.x*9.));
  nv.y+=uDt*hgt*7.*sin(q.x*11.+uTime*.6+q.y*4.);
  nv.x+=uDt*uDraft*smoothstep(.03,.45,vUv.y);
  vec2 dp=(vUv-uPtr.xy)/uPx; float g=exp(-dot(dp,dp)/(46.*46.))*uPtrOn;
  nv=mix(nv,uPtr.zw,g*.30);
  vec2 sp=(vUv-uSrc)/uPx; float s=exp(-dot(sp,sp)/14.);
  nv=mix(nv,vec2(5.*sin(uTime*1.7)+3.*sin(uTime*4.3),70.+90.*uBurst),s);
  nv*=.9988;
  float edge=smoothstep(0.,.03,vUv.x)*smoothstep(1.,.97,vUv.x);
  nv.x*=edge;
  o=vec4(nv,0.,1.);
}`;
SH.div = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uVel; uniform vec2 uPx;
void main(){
  float L=texture(uVel,vUv-vec2(uPx.x,0.)).x, R=texture(uVel,vUv+vec2(uPx.x,0.)).x;
  float B=texture(uVel,vUv-vec2(0.,uPx.y)).y, T=texture(uVel,vUv+vec2(0.,uPx.y)).y;
  o=vec4(.5*(R-L+T-B),0.,0.,1.);
}`;
SH.jac = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uP; uniform sampler2D uDiv; uniform vec2 uPx;
void main(){
  float L=texture(uP,vUv-vec2(uPx.x,0.)).r, R=texture(uP,vUv+vec2(uPx.x,0.)).r;
  float B=texture(uP,vUv-vec2(0.,uPx.y)).r, T=texture(uP,vUv+vec2(0.,uPx.y)).r;
  o=vec4((L+R+B+T-texture(uDiv,vUv).r)*.25,0.,0.,1.);
}`;
SH.grad = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uP; uniform sampler2D uVel; uniform vec2 uPx;
void main(){
  float L=texture(uP,vUv-vec2(uPx.x,0.)).r, R=texture(uP,vUv+vec2(uPx.x,0.)).r;
  float B=texture(uP,vUv-vec2(0.,uPx.y)).r, T=texture(uP,vUv+vec2(0.,uPx.y)).r;
  o=vec4(texture(uVel,vUv).xy-vec2(R-L,T-B),0.,1.);
}`;
SH.den = `#version 300 es
precision highp float; in vec2 vUv; out vec4 o;
uniform sampler2D uVel; uniform sampler2D uDen; uniform vec2 uPx; uniform float uDt; uniform vec2 uSrc; uniform float uBurst; uniform float uTime;
void main(){
  vec2 prev=vUv-uDt*(texture(uVel,vUv).xy+vec2(0.,44.))*uPx;
  vec2 d=texture(uDen,prev).xy;
  d.x*=mix(.9993,.9962,smoothstep(.2,.9,vUv.y)); d.y*=.978;
  vec2 sp=(vUv-uSrc)/uPx; sp.x-=1.2*sin(uTime*2.3);
  float r2=5.+16.*uBurst;
  float s=exp(-dot(sp,sp)/r2);
  d=max(d,vec2(s*(1.25+.9*uBurst),s*(1.+.6*uBurst)));
  float m=smoothstep(0.,.07,vUv.x)*smoothstep(1.,.93,vUv.x)*smoothstep(1.,.86,vUv.y);
  d.x*=mix(.955,1.,m);
  o=vec4(d,0.,1.);
}`;
