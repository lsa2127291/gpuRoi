struct Params {
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
