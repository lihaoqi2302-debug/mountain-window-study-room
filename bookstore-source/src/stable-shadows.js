import { ShaderChunk } from 'three';

export function configureStableRoomLighting() {
  // Three's PCF rotates the taps by screen-pixel noise. A surface then picks
  // different samples while the camera pans, even with a cached shadow map.
  // Keep the soft Vogel filter, with a fixed rotation in the light's map.
  ShaderChunk.shadowmap_pars_fragment = ShaderChunk.shadowmap_pars_fragment.replaceAll(
    'interleavedGradientNoise( gl_FragCoord.xy ) * PI2',
    '0.63',
  );

  // The point-light BRDF can spike on nearly edge-on opaque faces. Fade the
  // lobe at the shading normal's horizon and roll off unusually hot glints
  // before they enter the HDR buffer and spread through bloom.
  ShaderChunk.lights_physical_pars_fragment = ShaderChunk.lights_physical_pars_fragment
    .replace(
      'void RE_Direct_Physical(',
      `vec3 stableRoomSpecular( vec3 radiance, vec3 normal, vec3 viewDir ) {
        float horizon = smoothstep( 0.0, 0.06, dot( normal, viewDir ) );
        float peak = luminance( radiance );
        float excess = max( peak - 0.7, 0.0 );
        float softPeak = 0.7 + excess / ( 1.0 + excess / 0.5 );
        return radiance * ( horizon * min( 1.0, softPeak / max( peak, 0.001 ) ) );
      }

      void RE_Direct_Physical(`,
    )
    .replace(
      'reflectedLight.directSpecular += irradiance * specularBRDF * material.multiScatteringCompensation;',
      `reflectedLight.directSpecular += stableRoomSpecular(
        irradiance * specularBRDF * material.multiScatteringCompensation, geometryNormal, geometryViewDir );`,
    )
    .replace(
      'clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );',
      `clearcoatSpecularDirect += stableRoomSpecular(
        ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material ),
        geometryClearcoatNormal, geometryViewDir );`,
    );
}

// Refresh a fixed light's shadow map only for moving shadow casters.
export function createStableShadows(renderer,objects) {
  const previous=new Map();let dirty=true;
  renderer.shadowMap.autoUpdate=false;
  return {
    invalidate(){dirty=true;},
    update(deforming=false){
      let changed=dirty||deforming;dirty=false;
      const current=objects().filter(Boolean),live=new Set(current);
      for(const object of current){
        const values=[...object.position.toArray(),...object.quaternion.toArray(),...object.scale.toArray(),Number(object.visible)];
        const old=previous.get(object);
        if(!old||values.some((v,i)=>Math.abs(v-old[i])>1e-6)){changed=true;previous.set(object,values);}
      }
      for(const object of previous.keys())if(!live.has(object)){previous.delete(object);changed=true;}
      if(changed)renderer.shadowMap.needsUpdate=true;
      return changed;
    },
  };
}
