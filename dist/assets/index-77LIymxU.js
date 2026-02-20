(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const n of document.querySelectorAll('link[rel="modulepreload"]'))i(n);new MutationObserver(n=>{for(const r of n)if(r.type==="childList")for(const a of r.addedNodes)a.tagName==="LINK"&&a.rel==="modulepreload"&&i(a)}).observe(document,{childList:!0,subtree:!0});function t(n){const r={};return n.integrity&&(r.integrity=n.integrity),n.referrerPolicy&&(r.referrerPolicy=n.referrerPolicy),n.crossOrigin==="use-credentials"?r.credentials="include":n.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function i(n){if(n.ep)return;n.ep=!0;const r=t(n);fetch(n.href,r)}})();let x=null,E=!1;async function H(){if(E)return x;if(E=!0,typeof navigator>"u"||!navigator.gpu)return null;try{const s=await navigator.gpu.requestAdapter();return s?(x=await s.requestDevice(),x.lost.then(e=>{console.warn("WebGPU device lost:",e.message),x=null,E=!1}),x):null}catch{return null}}function A(s,e){return s[0]*e[0]+s[1]*e[1]+s[2]*e[2]}function T(s,e){return[s[1]*e[2]-s[2]*e[1],s[2]*e[0]-s[0]*e[2],s[0]*e[1]-s[1]*e[0]]}function O(s,e){return[s[0]-e[0],s[1]-e[1],s[2]-e[2]]}function S(s){const e=Math.sqrt(s[0]*s[0]+s[1]*s[1]+s[2]*s[2]);return e<1e-10?[0,0,0]:[s[0]/e,s[1]/e,s[2]/e]}function Y(s,e,t){return[s[0]+(e[0]-s[0])*t,s[1]+(e[1]-s[1])*t,s[2]+(e[2]-s[2])*t]}const m=1e-8;function L(s){const e=[1/0,1/0,1/0],t=[-1/0,-1/0,-1/0];for(let i=0;i<s.length;i+=3)for(let n=0;n<3;n++)s[i+n]<e[n]&&(e[n]=s[i+n]),s[i+n]>t[n]&&(t[n]=s[i+n]);return{min:e,max:t}}function z(s,e,t){let i=1/0,n=-1/0;for(let r=0;r<8;r++){const a=[r&1?t.max[0]:t.min[0],r&2?t.max[1]:t.min[1],r&4?t.max[2]:t.min[2]],o=A(s,O(a,e));o<i&&(i=o),o>n&&(n=o)}return i<=m&&n>=-m}function I(s,e){const t=e*3;return[s[t],s[t+1],s[t+2]]}function M(s,e,t){return A(e,O(s,t))}function j(s,e,t){const{vertices:i,indices:n}=s,r=L(i);if(!z(e,t,r))return[];const a=[],o=n.length/3;for(let u=0;u<o;u++){const l=n[u*3],h=n[u*3+1],d=n[u*3+2],f=I(i,l),c=I(i,h),B=I(i,d),g=M(f,e,t),p=M(c,e,t),v=M(B,e,t),P=Math.abs(g)<=m,C=Math.abs(p)<=m,U=Math.abs(v)<=m;if(g>m&&p>m&&v>m||g<-m&&p<-m&&v<-m||P&&C&&U)continue;const y=[];R(f,c,g,p,y),R(c,B,p,v,y),R(B,f,v,g,y),P&&G(y,f),C&&G(y,c),U&&G(y,B),y.length>=2&&a.push({start:y[0],end:y[1]})}return a}function R(s,e,t,i,n){if(t>m&&i>m||t<-m&&i<-m||Math.abs(t)<=m&&Math.abs(i)<=m||Math.abs(t)<=m||Math.abs(i)<=m)return;const r=t/(t-i);G(n,Y(s,e,r))}function G(s,e){for(const t of s){const i=t[0]-e[0],n=t[1]-e[1],r=t[2]-e[2];if(i*i+n*n+r*r<m*m)return}s.push(e)}const X=`struct Params {
  normal: vec3f,
  _pad0: f32,
  anchor: vec3f,
  _pad1: f32,
  epsilon: f32,
  triCount: u32,
  _pad2: u32,
  _pad3: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> vertices: array<f32>;
@group(0) @binding(2) var<storage, read> indices: array<u32>;
@group(0) @binding(3) var<storage, read_write> segments: array<f32>;
@group(0) @binding(4) var<storage, read_write> counter: atomic<u32>;

fn getVertex(idx: u32) -> vec3f {
  let i = idx * 3u;
  return vec3f(vertices[i], vertices[i + 1u], vertices[i + 2u]);
}

fn signedDist(p: vec3f) -> f32 {
  return dot(params.normal, p - params.anchor);
}

fn lerpVec3(a: vec3f, b: vec3f, t: f32) -> vec3f {
  return a + (b - a) * t;
}

fn writeSegment(start: vec3f, end: vec3f) {
  let idx = atomicAdd(&counter, 1u);
  let base = idx * 6u;
  segments[base]      = start.x;
  segments[base + 1u] = start.y;
  segments[base + 2u] = start.z;
  segments[base + 3u] = end.x;
  segments[base + 4u] = end.y;
  segments[base + 5u] = end.z;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let triIdx = gid.x;
  if (triIdx >= params.triCount) {
    return;
  }

  let eps = params.epsilon;

  let i0 = indices[triIdx * 3u];
  let i1 = indices[triIdx * 3u + 1u];
  let i2 = indices[triIdx * 3u + 2u];

  let v0 = getVertex(i0);
  let v1 = getVertex(i1);
  let v2 = getVertex(i2);

  let d0 = signedDist(v0);
  let d1 = signedDist(v1);
  let d2 = signedDist(v2);

  // All on same side → skip
  if (d0 > eps && d1 > eps && d2 > eps) { return; }
  if (d0 < -eps && d1 < -eps && d2 < -eps) { return; }

  let on0 = abs(d0) <= eps;
  let on1 = abs(d1) <= eps;
  let on2 = abs(d2) <= eps;

  // Coplanar triangle → skip
  if (on0 && on1 && on2) { return; }

  // Collect intersection points (max 2 needed)
  var pts: array<vec3f, 6>;
  var count: u32 = 0u;

  // Edge intersections (only when endpoints straddle the plane)
  if (!on0 && !on1 && ((d0 > eps && d1 < -eps) || (d0 < -eps && d1 > eps))) {
    let t = d0 / (d0 - d1);
    pts[count] = lerpVec3(v0, v1, t);
    count += 1u;
  }
  if (!on1 && !on2 && ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps))) {
    let t = d1 / (d1 - d2);
    pts[count] = lerpVec3(v1, v2, t);
    count += 1u;
  }
  if (!on2 && !on0 && ((d2 > eps && d0 < -eps) || (d2 < -eps && d0 > eps))) {
    let t = d2 / (d2 - d0);
    pts[count] = lerpVec3(v2, v0, t);
    count += 1u;
  }

  // Vertices on plane
  if (on0 && count < 6u) { pts[count] = v0; count += 1u; }
  if (on1 && count < 6u) { pts[count] = v1; count += 1u; }
  if (on2 && count < 6u) { pts[count] = v2; count += 1u; }

  if (count >= 2u) {
    writeSegment(pts[0], pts[1]);
  }
}
`,Z=64,$=1e-8,D=48;class K{constructor(e){this.backend="gpu",this.pipeline=null,this.bindGroupLayout=null,this.bindGroup=null,this.uniformBuffer=null,this.vertexBuffer=null,this.indexBuffer=null,this.segmentBuffer=null,this.counterBuffer=null,this.readbackSegmentBuffer=null,this.readbackCounterBuffer=null,this.vertexBufferSize=0,this.indexBufferSize=0,this.segmentBufferSize=0,this.triCount=0,this.bbox=null,this.device=e}async init(e){var l,h,d,f;const{vertices:t,indices:i}=e;this.triCount=i.length/3,this.bbox=L(t),this.pipeline||this.createPipeline();const n=this.device,r=t.byteLength,a=i.byteLength,o=Math.max(this.triCount*6*4,4);let u=!1;(!this.vertexBuffer||this.vertexBufferSize<r)&&((l=this.vertexBuffer)==null||l.destroy(),this.vertexBufferSize=r,this.vertexBuffer=n.createBuffer({size:r,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),u=!0),n.queue.writeBuffer(this.vertexBuffer,0,t),(!this.indexBuffer||this.indexBufferSize<a)&&((h=this.indexBuffer)==null||h.destroy(),this.indexBufferSize=a,this.indexBuffer=n.createBuffer({size:a,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),u=!0),n.queue.writeBuffer(this.indexBuffer,0,i),this.uniformBuffer||(this.uniformBuffer=n.createBuffer({size:D,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),u=!0),(!this.segmentBuffer||this.segmentBufferSize<o)&&((d=this.segmentBuffer)==null||d.destroy(),(f=this.readbackSegmentBuffer)==null||f.destroy(),this.segmentBufferSize=o,this.segmentBuffer=n.createBuffer({size:o,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),this.readbackSegmentBuffer=n.createBuffer({size:o,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),u=!0),this.counterBuffer||(this.counterBuffer=n.createBuffer({size:4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST}),u=!0),this.readbackCounterBuffer||(this.readbackCounterBuffer=n.createBuffer({size:4,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST})),u&&(this.bindGroup=n.createBindGroup({layout:this.bindGroupLayout,entries:[{binding:0,resource:{buffer:this.uniformBuffer}},{binding:1,resource:{buffer:this.vertexBuffer}},{binding:2,resource:{buffer:this.indexBuffer}},{binding:3,resource:{buffer:this.segmentBuffer}},{binding:4,resource:{buffer:this.counterBuffer}}]}))}async slice(e,t){if(!this.pipeline||!this.bindGroup||!this.uniformBuffer)return[];if(this.bbox&&!z(e,t,this.bbox))return[];const i=this.device,n=new ArrayBuffer(D),r=new Float32Array(n),a=new Uint32Array(n);r[0]=e[0],r[1]=e[1],r[2]=e[2],r[4]=t[0],r[5]=t[1],r[6]=t[2],r[8]=$,a[9]=this.triCount,i.queue.writeBuffer(this.uniformBuffer,0,n),i.queue.writeBuffer(this.counterBuffer,0,new Uint32Array([0]));const o=i.createCommandEncoder(),u=o.beginComputePass();u.setPipeline(this.pipeline),u.setBindGroup(0,this.bindGroup),u.dispatchWorkgroups(Math.ceil(this.triCount/Z)),u.end(),o.copyBufferToBuffer(this.counterBuffer,0,this.readbackCounterBuffer,0,4),i.queue.submit([o.finish()]),await this.readbackCounterBuffer.mapAsync(GPUMapMode.READ);const h=new Uint32Array(this.readbackCounterBuffer.getMappedRange())[0];if(this.readbackCounterBuffer.unmap(),h===0)return[];const d=h*6*4,f=i.createCommandEncoder();f.copyBufferToBuffer(this.segmentBuffer,0,this.readbackSegmentBuffer,0,d),i.queue.submit([f.finish()]),await this.readbackSegmentBuffer.mapAsync(GPUMapMode.READ);const c=new Float32Array(this.readbackSegmentBuffer.getMappedRange(0,d)),B=[];for(let g=0;g<h;g++){const p=g*6;B.push({start:[c[p],c[p+1],c[p+2]],end:[c[p+3],c[p+4],c[p+5]]})}return this.readbackSegmentBuffer.unmap(),B}dispose(){this.disposeBuffers(),this.pipeline=null,this.bindGroupLayout=null}createPipeline(){const e=this.device,t=e.createShaderModule({code:X});this.bindGroupLayout=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:4,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}]}),this.pipeline=e.createComputePipeline({layout:e.createPipelineLayout({bindGroupLayouts:[this.bindGroupLayout]}),compute:{module:t,entryPoint:"main"}})}disposeBuffers(){var e,t,i,n,r,a,o;(e=this.vertexBuffer)==null||e.destroy(),(t=this.indexBuffer)==null||t.destroy(),(i=this.uniformBuffer)==null||i.destroy(),(n=this.segmentBuffer)==null||n.destroy(),(r=this.counterBuffer)==null||r.destroy(),(a=this.readbackSegmentBuffer)==null||a.destroy(),(o=this.readbackCounterBuffer)==null||o.destroy(),this.vertexBuffer=null,this.indexBuffer=null,this.uniformBuffer=null,this.segmentBuffer=null,this.counterBuffer=null,this.readbackSegmentBuffer=null,this.readbackCounterBuffer=null,this.bindGroup=null,this.vertexBufferSize=0,this.indexBufferSize=0,this.segmentBufferSize=0}}class J{constructor(){this.backend="cpu",this.mesh=null}async init(e){this.mesh=e}async slice(e,t){return this.mesh?j(this.mesh,e,t):[]}dispose(){this.mesh=null}}function Q(s,e={}){const{maxChunkBytes:t=128*1024*1024,maxStorageBufferBindingSize:i=128*1024*1024,maxBufferSize:n=256*1024*1024}=e,r=s.map((c,B)=>{const g=c.indices.length/3,p=c.vertices.byteLength,v=c.indices.byteLength,P=g*6*4;return{index:B,mesh:c,triCount:g,vertBytes:p,idxBytes:v,segBytes:P,totalBytes:p+v+P,bbox:L(c.vertices)}}),a=[];let o=[],u=0,l=0,h=0,d=0;const f=()=>{o.length!==0&&(a.push(ee(o)),o=[],u=0,l=0,h=0,d=0)};for(const c of r){const B=l+c.vertBytes,g=h+c.idxBytes,p=d+c.segBytes,P=u+c.totalBytes>t,C=B>i||g>i||p>i,U=B>n||g>n||p>n;o.length>0&&(P||C||U)&&f(),o.push(c),u+=c.totalBytes,l+=c.vertBytes,h+=c.idxBytes,d+=c.segBytes}return f(),a}function ee(s){let e=0,t=0,i=0,n=0;for(const f of s)e+=f.mesh.vertices.length,t+=f.mesh.indices.length,i+=f.triCount,n+=f.triCount;const r=new Float32Array(e),a=new Uint32Array(t),o=[];let u=0,l=0,h=0,d=0;for(const f of s){const{mesh:c}=f,B=u/3;r.set(c.vertices,u);for(let g=0;g<c.indices.length;g++)a[l+g]=c.indices[g]+B;o.push({triOffset:h,triCount:f.triCount,vertexFloatOffset:u,segOffset:d,bbox:f.bbox,meshIndex:f.index}),u+=c.vertices.length,l+=c.indices.length,h+=f.triCount,d+=f.triCount}return{vertices:r,indices:a,meshInfos:o,totalTriCount:i,totalSegCapacity:n}}function te(s,e){const t=S(s);let i=S(T(e,t));const n=S(T(t,i));return i=S(T(n,t)),{xAxis:i,yAxis:n,zAxis:t}}function k(s,e,t){const i=O(s,e),n=A(i,t.xAxis),r=A(i,t.yAxis);return[n,r]}function q(s,e,t,i){const n=e/2,r=t/2;return[n+s[0]*i,r-s[1]*i]}function he(s,e,t,i,n,r){return s.map(a=>{const o=k(a.start,e,t),u=k(a.end,e,t);return{start:q(o,i,n,r),end:q(u,i,n,r)}})}const ne=`struct SliceParams {
  normal: vec3f,
  _pad0: f32,
  anchor: vec3f,
  _pad1: f32,
  epsilon: f32,
  totalTriCount: u32,
  meshCount: u32,
  _pad2: u32,
}

struct RenderParams {
  anchor: vec3f,
  _pad0: f32,
  xAxis: vec3f,
  _pad1: f32,
  yAxis: vec3f,
  _pad2: f32,
  scale: f32,
  invHalfWidth: f32,
  invHalfHeight: f32,
  meshCount: u32,
}

struct MeshInfoEntry {
  triOffset: u32,
  triCount: u32,
  meshIndex: u32,
  _pad: u32,
}

struct SegmentEntry {
  start: vec3f,
  meshIndex: u32,
  end: vec3f,
  _pad: u32,
}

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
}

const LINE_HALF_WIDTH_PX: f32 = 0.95;
const LINE_CAP_EXTEND_PX: f32 = 0.75;

@group(0) @binding(0) var<uniform> sliceParams: SliceParams;
@group(0) @binding(1) var<storage, read> vertices: array<f32>;
@group(0) @binding(2) var<storage, read> indices: array<u32>;
@group(0) @binding(3) var<storage, read_write> segments: array<SegmentEntry>;
@group(0) @binding(4) var<storage, read_write> counters: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read> meshInfos: array<MeshInfoEntry>;
@group(0) @binding(6) var<storage, read_write> drawArgs: array<u32>;

@group(1) @binding(0) var<uniform> renderParams: RenderParams;
@group(1) @binding(1) var<storage, read> renderSegments: array<SegmentEntry>;
@group(1) @binding(2) var<storage, read> meshColors: array<vec4f>;

fn getVertex(idx: u32) -> vec3f {
  let i = idx * 3u;
  return vec3f(vertices[i], vertices[i + 1u], vertices[i + 2u]);
}

fn signedDist(p: vec3f) -> f32 {
  return dot(sliceParams.normal, p - sliceParams.anchor);
}

fn lerpVec3(a: vec3f, b: vec3f, t: f32) -> vec3f {
  return a + (b - a) * t;
}

fn findMeshIndex(globalTriIdx: u32) -> u32 {
  var lo: u32 = 0u;
  var hi: u32 = sliceParams.meshCount;
  loop {
    if (lo >= hi) { break; }
    let mid = (lo + hi) / 2u;
    let info = meshInfos[mid];
    if (globalTriIdx < info.triOffset) {
      hi = mid;
    } else if (globalTriIdx >= info.triOffset + info.triCount) {
      lo = mid + 1u;
    } else {
      return mid;
    }
  }
  return min(lo, sliceParams.meshCount - 1u);
}

@compute @workgroup_size(64)
fn slice_main(@builtin(global_invocation_id) gid: vec3u) {
  let globalTriIdx = gid.x;
  if (globalTriIdx >= sliceParams.totalTriCount) {
    return;
  }

  let eps = sliceParams.epsilon;

  let i0 = indices[globalTriIdx * 3u];
  let i1 = indices[globalTriIdx * 3u + 1u];
  let i2 = indices[globalTriIdx * 3u + 2u];

  let v0 = getVertex(i0);
  let v1 = getVertex(i1);
  let v2 = getVertex(i2);

  let d0 = signedDist(v0);
  let d1 = signedDist(v1);
  let d2 = signedDist(v2);

  if (d0 > eps && d1 > eps && d2 > eps) { return; }
  if (d0 < -eps && d1 < -eps && d2 < -eps) { return; }

  let on0 = abs(d0) <= eps;
  let on1 = abs(d1) <= eps;
  let on2 = abs(d2) <= eps;

  if (on0 && on1 && on2) { return; }

  var pts: array<vec3f, 6>;
  var count: u32 = 0u;

  if (!on0 && !on1 && ((d0 > eps && d1 < -eps) || (d0 < -eps && d1 > eps))) {
    let t = d0 / (d0 - d1);
    pts[count] = lerpVec3(v0, v1, t);
    count += 1u;
  }
  if (!on1 && !on2 && ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps))) {
    let t = d1 / (d1 - d2);
    pts[count] = lerpVec3(v1, v2, t);
    count += 1u;
  }
  if (!on2 && !on0 && ((d2 > eps && d0 < -eps) || (d2 < -eps && d0 > eps))) {
    let t = d2 / (d2 - d0);
    pts[count] = lerpVec3(v2, v0, t);
    count += 1u;
  }

  if (on0 && count < 6u) { pts[count] = v0; count += 1u; }
  if (on1 && count < 6u) { pts[count] = v1; count += 1u; }
  if (on2 && count < 6u) { pts[count] = v2; count += 1u; }

  if (count >= 2u) {
    let globalIdx = atomicAdd(&counters[0], 1u);
    let meshLocalIdx = findMeshIndex(globalTriIdx);
    let meshGlobalIdx = meshInfos[meshLocalIdx].meshIndex;

    segments[globalIdx].start = pts[0];
    segments[globalIdx].end = pts[1];
    segments[globalIdx].meshIndex = meshGlobalIdx;
    segments[globalIdx]._pad = 0u;
  }
}

@compute @workgroup_size(1)
fn build_draw_args(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x != 0u) {
    return;
  }

  let segmentCount = atomicLoad(&counters[0]);
  drawArgs[0] = 6u;
  drawArgs[1] = segmentCount;
  drawArgs[2] = 0u;
  drawArgs[3] = 0u;
}

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> VertexOut {
  let seg = renderSegments[instanceIndex];

  let relStart = seg.start - renderParams.anchor;
  let relEnd = seg.end - renderParams.anchor;

  let startNdc = vec2f(
    dot(relStart, renderParams.xAxis) * renderParams.scale * renderParams.invHalfWidth,
    dot(relStart, renderParams.yAxis) * renderParams.scale * renderParams.invHalfHeight,
  );
  let endNdc = vec2f(
    dot(relEnd, renderParams.xAxis) * renderParams.scale * renderParams.invHalfWidth,
    dot(relEnd, renderParams.yAxis) * renderParams.scale * renderParams.invHalfHeight,
  );

  let corners = array<vec2f, 6>(
    vec2f(0.0, -1.0),
    vec2f(1.0, -1.0),
    vec2f(0.0, 1.0),
    vec2f(0.0, 1.0),
    vec2f(1.0, -1.0),
    vec2f(1.0, 1.0),
  );
  let corner = corners[min(vertexIndex, 5u)];
  let t = corner.x;
  let side = corner.y;

  let baseNdc = mix(startNdc, endNdc, t);
  let dirNdc = endNdc - startNdc;

  let dirPx = vec2f(
    dirNdc.x / renderParams.invHalfWidth,
    dirNdc.y / renderParams.invHalfHeight,
  );
  let dirPxLen = max(length(dirPx), 1e-6);
  let dirPxUnit = dirPx / dirPxLen;
  let normalPxUnit = vec2f(-dirPxUnit.y, dirPxUnit.x);

  let offsetPx = normalPxUnit * LINE_HALF_WIDTH_PX * side;
  let capPx = dirPxUnit * LINE_CAP_EXTEND_PX * (t * 2.0 - 1.0);

  let offsetNdc = vec2f(
    offsetPx.x * renderParams.invHalfWidth,
    offsetPx.y * renderParams.invHalfHeight,
  );
  let capNdc = vec2f(
    capPx.x * renderParams.invHalfWidth,
    capPx.y * renderParams.invHalfHeight,
  );

  let safeMeshCount = max(renderParams.meshCount, 1u);
  let clampedMeshIndex = min(seg.meshIndex, safeMeshCount - 1u);

  var out: VertexOut;
  out.position = vec4f(baseNdc + offsetNdc + capNdc, 0.0, 1.0);
  out.color = meshColors[clampedMeshIndex];
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  return in.color;
}
`,ie=64,re=1e-8,N=48,V=64,w=32,se=16,F=4;function b(s){return Math.max(0,Math.min(1,s))}function ae(s){return[b(s[0]),b(s[1]),b(s[2]),b(s[3])]}function oe(s){const e=[];for(let t=0;t<s;t++){const i=s<=1?0:t/s,n=.8,r=.95,a=i*6,o=r*n,u=o*(1-Math.abs(a%2-1)),l=r-o;let h=0,d=0,f=0;a>=0&&a<1?(h=o,d=u,f=0):a>=1&&a<2?(h=u,d=o,f=0):a>=2&&a<3?(h=0,d=o,f=u):a>=3&&a<4?(h=0,d=u,f=o):a>=4&&a<5?(h=u,d=0,f=o):(h=o,d=0,f=u),e.push([h+l,d+l,f+l,1])}return e}function ue(s,e){const t=oe(s);if(e)for(let n=0;n<Math.min(s,e.length);n++)t[n]=ae(e[n]);const i=new Float32Array(s*4);for(let n=0;n<s;n++){const r=n*4,a=t[n];i[r]=a[0],i[r+1]=a[1],i[r+2]=a[2],i[r+3]=a[3]}return i}function _(s){return[s[0],s[1],s[2]]}function fe(s){return{viewUp:_(s.viewUp),width:s.width,height:s.height,scale:s.scale,clearColor:s.clearColor?[...s.clearColor]:void 0}}function W(s){return{vertices:new Float32Array(s.vertices),indices:new Uint32Array(s.indices),normals:s.normals?new Float32Array(s.normals):void 0}}function ce(s){if(s)return s.map(e=>[e[0],e[1],e[2],e[3]])}class de{constructor(e){this.backend="gpu",this.slicePipeline=null,this.drawArgsPipeline=null,this.renderPipeline=null,this.sliceBindGroupLayout=null,this.renderBindGroupLayout=null,this.renderUniformBuffer=null,this.meshColorBuffer=null,this.chunkGPUs=[],this.meshCount=0,this.outputCanvas=null,this.outputContext=null,this.msaaTexture=null,this.msaaTextureSize={width:0,height:0},this.zeroCounter=new Uint32Array([0]),this.zeroDrawArgs=new Uint32Array([6,0,0,0]),this.bitmapRenderRunning=!1,this.bitmapRequestSeq=0,this.pendingBitmapRequest=null,this.disposed=!1,this.sourceMeshes=[],this.device=e,this.canvasFormat=typeof navigator<"u"&&navigator.gpu?navigator.gpu.getPreferredCanvasFormat():"bgra8unorm"}async initBatch(e,t){var r;if(this.disposed)throw new Error("BatchGPUSlicer has been disposed");this.disposeChunks(),(!this.slicePipeline||!this.drawArgsPipeline||!this.renderPipeline)&&this.createPipelines(),this.renderUniformBuffer||(this.renderUniformBuffer=this.device.createBuffer({size:V,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})),this.meshCount=e.length,this.sourceMeshes=e.map(W),this.sourceColors=ce(t),(r=this.meshColorBuffer)==null||r.destroy();const i=ue(this.meshCount,t);this.meshColorBuffer=this.device.createBuffer({size:Math.max(i.byteLength,16),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),i.byteLength>0&&this.device.queue.writeBuffer(this.meshColorBuffer,0,i);const n=Q(e,{maxStorageBufferBindingSize:this.device.limits.maxStorageBufferBindingSize,maxBufferSize:this.device.limits.maxBufferSize});for(const a of n)this.chunkGPUs.push(this.createChunkGPU(a))}async updateMesh(e,t){if(this.disposed)throw new Error("BatchGPUSlicer has been disposed");if(e<0||e>=this.sourceMeshes.length)throw new Error(`meshIndex out of range: ${e}`);this.sourceMeshes[e]=W(t),await this.initBatch(this.sourceMeshes,this.sourceColors)}async sliceBatch(e,t){if(!this.slicePipeline||this.chunkGPUs.length===0)return[];const i=new Array(this.meshCount);for(let n=0;n<this.meshCount;n++)i[n]=[];for(const n of this.getActiveChunks(e,t)){const r=await this.dispatchAndReadCounter(n,e,t);if(r===0)continue;const a=await this.readbackSegments(n,r);for(const o of a)o.meshIndex>=0&&o.meshIndex<i.length&&i[o.meshIndex].push({start:o.start,end:o.end})}return i}async sliceBatchFlat(e,t){if(!this.slicePipeline||this.chunkGPUs.length===0)return[];const i=[];for(const n of this.getActiveChunks(e,t)){const r=await this.dispatchAndReadCounter(n,e,t);if(r===0)continue;const a=await this.readbackSegments(n,r);for(const o of a)i.push({start:o.start,end:o.end})}return i}async sliceToBitmap(e,t,i){if(this.disposed)throw new Error("BatchGPUSlicer has been disposed");if(!this.slicePipeline||!this.drawArgsPipeline||!this.renderPipeline)throw new Error("BatchGPUSlicer is not initialized");if(!this.renderUniformBuffer||!this.meshColorBuffer)throw new Error("BatchGPUSlicer buffers are not initialized");return new Promise((n,r)=>{const a={resolve:n,reject:r},o={seq:++this.bitmapRequestSeq,normal:_(e),anchor:_(t),options:fe(i),waiters:this.pendingBitmapRequest?[...this.pendingBitmapRequest.waiters,a]:[a]};this.pendingBitmapRequest=o,this.bitmapRenderRunning||this.runBitmapRenderLoop()})}dispose(){var e,t,i;this.disposed=!0,this.pendingBitmapRequest&&(this.rejectBitmapWaiters(this.pendingBitmapRequest.waiters,new Error("BatchGPUSlicer has been disposed")),this.pendingBitmapRequest=null),this.disposeChunks(),(e=this.renderUniformBuffer)==null||e.destroy(),(t=this.meshColorBuffer)==null||t.destroy(),(i=this.msaaTexture)==null||i.destroy(),this.renderUniformBuffer=null,this.meshColorBuffer=null,this.msaaTexture=null,this.msaaTextureSize={width:0,height:0},this.slicePipeline=null,this.drawArgsPipeline=null,this.renderPipeline=null,this.sliceBindGroupLayout=null,this.renderBindGroupLayout=null,this.outputContext=null,this.outputCanvas=null,this.meshCount=0,this.sourceMeshes=[],this.sourceColors=void 0}async runBitmapRenderLoop(){if(!this.bitmapRenderRunning){this.bitmapRenderRunning=!0;try{for(;this.pendingBitmapRequest;){const e=this.pendingBitmapRequest;if(this.pendingBitmapRequest=null,this.disposed){this.rejectBitmapWaiters(e.waiters,new Error("BatchGPUSlicer has been disposed"));continue}try{const t=await this.renderBitmapOnce(e.normal,e.anchor,e.options),i=this.pendingBitmapRequest;if(i&&i.seq>e.seq){t.close(),i.waiters=[...i.waiters,...e.waiters];continue}if(this.disposed){t.close(),this.rejectBitmapWaiters(e.waiters,new Error("BatchGPUSlicer has been disposed"));continue}await this.resolveBitmapWaiters(e.waiters,t)}catch(t){this.rejectBitmapWaiters(e.waiters,t)}}}finally{this.bitmapRenderRunning=!1,!this.disposed&&this.pendingBitmapRequest&&this.runBitmapRenderLoop()}}}async renderBitmapOnce(e,t,i){if(!this.slicePipeline||!this.drawArgsPipeline||!this.renderPipeline)throw new Error("BatchGPUSlicer is not initialized");if(!this.renderUniformBuffer||!this.meshColorBuffer)throw new Error("BatchGPUSlicer buffers are not initialized");const n=Math.max(1,Math.floor(i.width)),r=Math.max(1,Math.floor(i.height));this.ensureOutputContext(n,r),this.ensureMsaaTexture(n,r);const a=this.getActiveChunks(e,t);this.writeRenderUniform(e,t,i);const o=this.device.createCommandEncoder();a.length>0&&this.encodeSlicePass(o,a,e,t);const u=i.clearColor??[0,0,0,0],l=this.outputContext.getCurrentTexture().createView(),h={view:this.msaaTexture?this.msaaTexture.createView():l,resolveTarget:this.msaaTexture?l:void 0,loadOp:"clear",clearValue:{r:b(u[0]),g:b(u[1]),b:b(u[2]),a:b(u[3])},storeOp:"store"},d=o.beginRenderPass({colorAttachments:[h]});d.setPipeline(this.renderPipeline);for(const f of a)d.setBindGroup(1,f.renderBindGroup),d.drawIndirect(f.indirectBuffer,0);return d.end(),this.device.queue.submit([o.finish()]),await this.device.queue.onSubmittedWorkDone(),this.captureBitmap()}async resolveBitmapWaiters(e,t){if(e.length===0){t.close();return}const i=[t];try{for(let n=1;n<e.length;n++)i.push(await this.cloneBitmap(t))}catch(n){for(const r of i)r.close();this.rejectBitmapWaiters(e,n);return}for(let n=0;n<e.length;n++)e[n].resolve(i[n])}rejectBitmapWaiters(e,t){for(const i of e)i.reject(t)}async cloneBitmap(e){if(typeof createImageBitmap=="function")return createImageBitmap(e);throw new Error("createImageBitmap is required when sliceToBitmap has merged waiters")}createPipelines(){const e=this.device.createShaderModule({code:ne});this.sliceBindGroupLayout=this.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:4,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:5,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:6,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}]}),this.renderBindGroupLayout=this.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.VERTEX,buffer:{type:"read-only-storage"}}]}),this.slicePipeline=this.device.createComputePipeline({layout:this.device.createPipelineLayout({bindGroupLayouts:[this.sliceBindGroupLayout]}),compute:{module:e,entryPoint:"slice_main"}}),this.drawArgsPipeline=this.device.createComputePipeline({layout:this.device.createPipelineLayout({bindGroupLayouts:[this.sliceBindGroupLayout]}),compute:{module:e,entryPoint:"build_draw_args"}});const t=this.device.createBindGroupLayout({entries:[]});this.renderPipeline=this.device.createRenderPipeline({layout:this.device.createPipelineLayout({bindGroupLayouts:[t,this.renderBindGroupLayout]}),vertex:{module:e,entryPoint:"vs_main"},fragment:{module:e,entryPoint:"fs_main",targets:[{format:this.canvasFormat}]},primitive:{topology:"triangle-list"},multisample:{count:F}})}createChunkGPU(e){if(!this.sliceBindGroupLayout||!this.renderBindGroupLayout||!this.renderUniformBuffer||!this.meshColorBuffer)throw new Error("BatchGPUSlicer pipelines are not initialized");const t=e.meshInfos.length,i=Math.max(e.totalSegCapacity*w,w),n=this.device.createBuffer({size:e.vertices.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});this.device.queue.writeBuffer(n,0,e.vertices);const r=this.device.createBuffer({size:e.indices.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});this.device.queue.writeBuffer(r,0,e.indices);const a=this.device.createBuffer({size:N,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),o=this.device.createBuffer({size:i,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),u=this.device.createBuffer({size:4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST}),l=new Uint32Array(t*4);for(let p=0;p<t;p++){const v=e.meshInfos[p];l[p*4]=v.triOffset,l[p*4+1]=v.triCount,l[p*4+2]=v.meshIndex,l[p*4+3]=0}const h=this.device.createBuffer({size:Math.max(l.byteLength,16),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});l.byteLength>0&&this.device.queue.writeBuffer(h,0,l);const d=this.device.createBuffer({size:se,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.INDIRECT|GPUBufferUsage.COPY_DST}),f=this.device.createBuffer({size:4,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),c=this.device.createBuffer({size:i,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),B=this.device.createBindGroup({layout:this.sliceBindGroupLayout,entries:[{binding:0,resource:{buffer:a}},{binding:1,resource:{buffer:n}},{binding:2,resource:{buffer:r}},{binding:3,resource:{buffer:o}},{binding:4,resource:{buffer:u}},{binding:5,resource:{buffer:h}},{binding:6,resource:{buffer:d}}]}),g=this.device.createBindGroup({layout:this.renderBindGroupLayout,entries:[{binding:0,resource:{buffer:this.renderUniformBuffer}},{binding:1,resource:{buffer:o}},{binding:2,resource:{buffer:this.meshColorBuffer}}]});return{chunk:e,workgroupCount:Math.ceil(e.totalTriCount/ie),localMeshCount:t,sliceUniformBuffer:a,vertexBuffer:n,indexBuffer:r,segmentBuffer:o,counterBuffer:u,meshInfoBuffer:h,indirectBuffer:d,readbackCounterBuffer:f,readbackSegmentBuffer:c,segmentByteCapacity:i,sliceBindGroup:B,renderBindGroup:g}}encodeSlicePass(e,t,i,n){for(const a of t)this.writeSliceUniform(a,i,n),this.device.queue.writeBuffer(a.counterBuffer,0,this.zeroCounter),this.device.queue.writeBuffer(a.indirectBuffer,0,this.zeroDrawArgs);const r=e.beginComputePass();for(const a of t)r.setPipeline(this.slicePipeline),r.setBindGroup(0,a.sliceBindGroup),r.dispatchWorkgroups(a.workgroupCount),r.setPipeline(this.drawArgsPipeline),r.setBindGroup(0,a.sliceBindGroup),r.dispatchWorkgroups(1);r.end()}writeSliceUniform(e,t,i){const n=new ArrayBuffer(N),r=new Float32Array(n),a=new Uint32Array(n);r[0]=t[0],r[1]=t[1],r[2]=t[2],r[4]=i[0],r[5]=i[1],r[6]=i[2],r[8]=re,a[9]=e.chunk.totalTriCount,a[10]=e.localMeshCount,this.device.queue.writeBuffer(e.sliceUniformBuffer,0,n)}writeRenderUniform(e,t,i){if(!this.renderUniformBuffer)return;const n=te(e,i.viewUp),r=Math.max(1,i.width),a=Math.max(1,i.height),o=new ArrayBuffer(V),u=new Float32Array(o),l=new Uint32Array(o);u[0]=t[0],u[1]=t[1],u[2]=t[2],u[4]=n.xAxis[0],u[5]=n.xAxis[1],u[6]=n.xAxis[2],u[8]=n.yAxis[0],u[9]=n.yAxis[1],u[10]=n.yAxis[2],u[12]=i.scale,u[13]=2/r,u[14]=2/a,l[15]=this.meshCount,this.device.queue.writeBuffer(this.renderUniformBuffer,0,o)}getActiveChunks(e,t){const i=[];for(const n of this.chunkGPUs){let r=!1;for(const a of n.chunk.meshInfos)if(z(e,t,a.bbox)){r=!0;break}r&&i.push(n)}return i}async dispatchAndReadCounter(e,t,i){this.writeSliceUniform(e,t,i),this.device.queue.writeBuffer(e.counterBuffer,0,this.zeroCounter),this.device.queue.writeBuffer(e.indirectBuffer,0,this.zeroDrawArgs);const n=this.device.createCommandEncoder(),r=n.beginComputePass();r.setPipeline(this.slicePipeline),r.setBindGroup(0,e.sliceBindGroup),r.dispatchWorkgroups(e.workgroupCount),r.setPipeline(this.drawArgsPipeline),r.setBindGroup(0,e.sliceBindGroup),r.dispatchWorkgroups(1),r.end(),n.copyBufferToBuffer(e.counterBuffer,0,e.readbackCounterBuffer,0,4),this.device.queue.submit([n.finish()]),await e.readbackCounterBuffer.mapAsync(GPUMapMode.READ);const a=new Uint32Array(e.readbackCounterBuffer.getMappedRange(0,4))[0];return e.readbackCounterBuffer.unmap(),a}async readbackSegments(e,t){const i=t*w,n=this.device.createCommandEncoder();n.copyBufferToBuffer(e.segmentBuffer,0,e.readbackSegmentBuffer,0,i),this.device.queue.submit([n.finish()]),await e.readbackSegmentBuffer.mapAsync(GPUMapMode.READ);const r=new DataView(e.readbackSegmentBuffer.getMappedRange(0,i)),a=[];for(let o=0;o<t;o++){const u=o*w;a.push({start:[r.getFloat32(u,!0),r.getFloat32(u+4,!0),r.getFloat32(u+8,!0)],meshIndex:r.getUint32(u+12,!0),end:[r.getFloat32(u+16,!0),r.getFloat32(u+20,!0),r.getFloat32(u+24,!0)]})}return e.readbackSegmentBuffer.unmap(),a}ensureOutputContext(e,t){if(!this.outputCanvas||!this.outputContext){if(typeof OffscreenCanvas<"u")this.outputCanvas=new OffscreenCanvas(e,t);else if(typeof document<"u"){const n=document.createElement("canvas");n.width=e,n.height=t,this.outputCanvas=n}else throw new Error("No canvas surface available for bitmap output");const i=this.outputCanvas.getContext("webgpu");if(!i)throw new Error("Failed to create WebGPU canvas context for bitmap output");this.outputContext=i}this.outputCanvas.width!==e&&(this.outputCanvas.width=e),this.outputCanvas.height!==t&&(this.outputCanvas.height=t),this.outputContext.configure({device:this.device,format:this.canvasFormat,alphaMode:"premultiplied",usage:GPUTextureUsage.RENDER_ATTACHMENT})}ensureMsaaTexture(e,t){var i;this.msaaTexture&&this.msaaTextureSize.width===e&&this.msaaTextureSize.height===t||((i=this.msaaTexture)==null||i.destroy(),this.msaaTexture=this.device.createTexture({size:{width:e,height:t,depthOrArrayLayers:1},format:this.canvasFormat,sampleCount:F,usage:GPUTextureUsage.RENDER_ATTACHMENT}),this.msaaTextureSize={width:e,height:t})}async captureBitmap(){if(!this.outputCanvas)throw new Error("Output canvas is not initialized");if(typeof OffscreenCanvas<"u"&&this.outputCanvas instanceof OffscreenCanvas)return this.outputCanvas.transferToImageBitmap();if(typeof createImageBitmap=="function")return createImageBitmap(this.outputCanvas);throw new Error("createImageBitmap is not available")}disposeChunks(){for(const e of this.chunkGPUs)e.sliceUniformBuffer.destroy(),e.vertexBuffer.destroy(),e.indexBuffer.destroy(),e.segmentBuffer.destroy(),e.counterBuffer.destroy(),e.meshInfoBuffer.destroy(),e.indirectBuffer.destroy(),e.readbackCounterBuffer.destroy(),e.readbackSegmentBuffer.destroy();this.chunkGPUs=[]}}async function pe(){const s=await H();return s?new K(s):new J}async function ge(){const s=await H();return s?new de(s):null}const le={color:"#ff0000",lineWidth:2,scale:1};class me{constructor(e,t){this.canvas=e;const i=e.getContext("2d");if(!i)throw new Error("Failed to get Canvas 2D context");this.ctx=i,this.style={...le,...t}}get width(){return this.canvas.width}get height(){return this.canvas.height}get scale(){return this.style.scale}setStyle(e){this.style={...this.style,...e}}clear(){this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height)}drawSegments(e){this.clear();const{ctx:t}=this;t.strokeStyle=this.style.color,t.lineWidth=this.style.lineWidth,t.lineCap="round",t.lineJoin="round",t.beginPath();for(const i of e)t.moveTo(i.start[0],i.start[1]),t.lineTo(i.end[0],i.end[1]);t.stroke()}}const Be={Axial:{viewPlaneNormal:[0,0,-1],viewUp:[0,-1,0]},Sagittal:{viewPlaneNormal:[-1,0,0],viewUp:[0,0,1]},Coronal:{viewPlaneNormal:[0,-1,0],viewUp:[0,0,1]}};export{me as C,Be as M,T as a,te as b,pe as c,A as d,ge as e,k as f,S as n,he as p,O as s};
