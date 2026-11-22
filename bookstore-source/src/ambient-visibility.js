// GTAO's normal override otherwise turns transparent fire, glass and haze into
// solid depth cards. Exclude them only during this pass; preserve prior state.
export function opaqueAmbientRender(scene,render) {
  const hidden=[];
  return (...args)=>{
    scene.traverse(object=>{
      if(!object.visible || !object.material)return;
      const materials=Array.isArray(object.material)?object.material:[object.material];
      if(materials.length && materials.every(material=>material.transparent && !material.depthWrite)){
        hidden.push(object);object.visible=false;
      }
    });
    try { return render(...args); }
    finally { for(const object of hidden)object.visible=true;hidden.length=0; }
  };
}
