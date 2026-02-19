struct SliceParams {
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
