// 批量切面 compute shader v2
// 使用全局 atomic counter 实现紧凑输出，避免稀疏 segment buffer

struct Params {
  normal: vec3f,
  _pad0: f32,
  anchor: vec3f,
  _pad1: f32,
  epsilon: f32,
  totalTriCount: u32,
  meshCount: u32,
  _pad3: u32,
}

struct MeshInfoEntry {
  triOffset: u32,
  triCount: u32,
  segOffset: u32,  // 未使用，保留兼容
  _pad: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> vertices: array<f32>;
@group(0) @binding(2) var<storage, read> indices: array<u32>;
@group(0) @binding(3) var<storage, read_write> segments: array<f32>;
// counters[0] = 全局 segment 计数器
// counters[1..meshCount] = 每个 mesh 的 segment 计数
@group(0) @binding(4) var<storage, read_write> counters: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read> meshInfos: array<MeshInfoEntry>;

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

fn findMeshIndex(globalTriIdx: u32) -> u32 {
  var lo: u32 = 0u;
  var hi: u32 = params.meshCount;
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
  return lo;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let globalTriIdx = gid.x;
  if (globalTriIdx >= params.totalTriCount) {
    return;
  }

  let eps = params.epsilon;

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
    // 全局紧凑写入
    let globalIdx = atomicAdd(&counters[0], 1u);
    let base = globalIdx * 6u;
    segments[base]      = pts[0].x;
    segments[base + 1u] = pts[0].y;
    segments[base + 2u] = pts[0].z;
    segments[base + 3u] = pts[1].x;
    segments[base + 4u] = pts[1].y;
    segments[base + 5u] = pts[1].z;

    // 同时递增 per-mesh 计数（用于统计，偏移 1 因为 counters[0] 是全局计数）
    let meshIdx = findMeshIndex(globalTriIdx);
    atomicAdd(&counters[meshIdx + 1u], 1u);
  }
}
