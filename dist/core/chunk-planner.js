import { computeBoundingBox } from './slicer';
/**
 * 将 mesh 列表拆分为若干 chunk
 * 每个 chunk 的拼接 buffer 不超过设备限制和预算
 */
export function planChunks(meshes, options = {}) {
    const { maxChunkBytes = 128 * 1024 * 1024, maxStorageBufferBindingSize = 128 * 1024 * 1024, maxBufferSize = 256 * 1024 * 1024, } = options;
    // 预计算每个 mesh 的信息
    const meshMetas = meshes.map((mesh, i) => {
        const triCount = mesh.indices.length / 3;
        const vertBytes = mesh.vertices.byteLength;
        const idxBytes = mesh.indices.byteLength;
        const segBytes = triCount * 6 * 4; // 每个 segment 6 个 float
        return {
            index: i,
            mesh,
            triCount,
            vertBytes,
            idxBytes,
            segBytes,
            totalBytes: vertBytes + idxBytes + segBytes,
            bbox: computeBoundingBox(mesh.vertices),
        };
    });
    const chunks = [];
    let currentMeshes = [];
    let currentBytes = 0;
    let currentVertBytes = 0;
    let currentIdxBytes = 0;
    let currentSegBytes = 0;
    const flush = () => {
        if (currentMeshes.length === 0)
            return;
        chunks.push(buildChunk(currentMeshes));
        currentMeshes = [];
        currentBytes = 0;
        currentVertBytes = 0;
        currentIdxBytes = 0;
        currentSegBytes = 0;
    };
    for (const meta of meshMetas) {
        const nextVertBytes = currentVertBytes + meta.vertBytes;
        const nextIdxBytes = currentIdxBytes + meta.idxBytes;
        const nextSegBytes = currentSegBytes + meta.segBytes;
        const nextTotal = currentBytes + meta.totalBytes;
        // 检查是否超限
        const exceedsBudget = nextTotal > maxChunkBytes;
        const exceedsStorageBinding = nextVertBytes > maxStorageBufferBindingSize ||
            nextIdxBytes > maxStorageBufferBindingSize ||
            nextSegBytes > maxStorageBufferBindingSize;
        const exceedsBufferSize = nextVertBytes > maxBufferSize ||
            nextIdxBytes > maxBufferSize ||
            nextSegBytes > maxBufferSize;
        if (currentMeshes.length > 0 && (exceedsBudget || exceedsStorageBinding || exceedsBufferSize)) {
            flush();
        }
        currentMeshes.push(meta);
        currentBytes += meta.totalBytes;
        currentVertBytes += meta.vertBytes;
        currentIdxBytes += meta.idxBytes;
        currentSegBytes += meta.segBytes;
    }
    flush();
    return chunks;
}
function buildChunk(meshMetas) {
    // 计算总大小
    let totalVertFloats = 0;
    let totalIdxCount = 0;
    let totalTriCount = 0;
    let totalSegCapacity = 0;
    for (const meta of meshMetas) {
        totalVertFloats += meta.mesh.vertices.length;
        totalIdxCount += meta.mesh.indices.length;
        totalTriCount += meta.triCount;
        totalSegCapacity += meta.triCount;
    }
    const vertices = new Float32Array(totalVertFloats);
    const indices = new Uint32Array(totalIdxCount);
    const meshInfos = [];
    let vertFloatOffset = 0;
    let idxOffset = 0;
    let triOffset = 0;
    let segOffset = 0;
    for (const meta of meshMetas) {
        const { mesh } = meta;
        const vertexBaseIndex = vertFloatOffset / 3; // 顶点索引偏移
        // 拷贝顶点
        vertices.set(mesh.vertices, vertFloatOffset);
        // 拷贝索引（重映射：加上顶点偏移）
        for (let i = 0; i < mesh.indices.length; i++) {
            indices[idxOffset + i] = mesh.indices[i] + vertexBaseIndex;
        }
        meshInfos.push({
            triOffset,
            triCount: meta.triCount,
            vertexFloatOffset: vertFloatOffset,
            segOffset,
            bbox: meta.bbox,
            meshIndex: meta.index,
        });
        vertFloatOffset += mesh.vertices.length;
        idxOffset += mesh.indices.length;
        triOffset += meta.triCount;
        segOffset += meta.triCount;
    }
    return {
        vertices,
        indices,
        meshInfos,
        totalTriCount,
        totalSegCapacity,
    };
}
//# sourceMappingURL=chunk-planner.js.map