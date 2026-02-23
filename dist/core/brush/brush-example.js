import { getCanvasSize, isPointInPolygon, } from '.';
import { viewerCore } from '@/containers/Viewer/Viewer3d/core';
import Shape from '@doodle3d/clipper-js';
class Point2 {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
    // 计算与另一个 Point2 点的差值向量
    subtract(other) {
        return new Point2(this.x - other.x, this.y - other.y);
    }
    // 计算与另一个 Point2 点的和向量
    add(other) {
        return new Point2(this.x + other.x, this.y + other.y);
    }
    // 计算点的长度（模）
    length() {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }
    toShapeValue() {
        // return [this.x, this.y]
        return {
            X: this.x * Point2.contourScale,
            Y: this.y * Point2.contourScale,
        };
    }
}
Point2.contourScale = 1;
function GetOval(from, to, radius, contourScale) {
    const point = to.subtract(from);
    const a = new Point2(0 - point.y, point.x);
    Point2.contourScale = contourScale;
    const num = point.y >= 0 ? Math.PI + Math.asin((0 - point.x) / a.length()) : Math.asin(point.x / a.length());
    const array = new Array(40);
    let num2 = 0;
    let num3 = 0;
    // 生成从 from 到 to 的椭圆上半部分的点
    while (num2 < 18) {
        array[num3] = from
            .add(new Point2(radius * Math.cos(num + (num2 * 10 * Math.PI) / 180), radius * Math.sin(num + (num2 * 10 * Math.PI) / 180)))
            .toShapeValue();
        num2++;
        num3++;
    }
    // 添加特殊位置的点
    array[num3++] = from
        .add(new Point2(radius * Math.cos(num + Math.PI), radius * Math.sin(num + Math.PI)))
        .toShapeValue();
    array[num3++] = to.add(new Point2(radius * Math.cos(num + Math.PI), radius * Math.sin(num + Math.PI))).toShapeValue();
    // 生成从 to 到 from 的椭圆下半部分的点
    while (num2 < 36) {
        array[num3] = to
            .add(new Point2(radius * Math.cos(num + (num2 * 10 * Math.PI) / 180), radius * Math.sin(num + (num2 * 10 * Math.PI) / 180)))
            .toShapeValue();
        num2++;
        num3++;
    }
    // 闭合椭圆路径
    array[num3++] = to.add(new Point2(radius * Math.cos(num), radius * Math.sin(num))).toShapeValue();
    array[num3] = array[0];
    return [array];
}
export const generateShapeFromBrush = (centerPoint, lastCenterPoint, radius, numPoints, imageSet) => {
    const points = [];
    // const contourScale = imageSet.contourScale
    const contourScale = 10;
    // console.log('contourScale', contourScale)
    if (lastCenterPoint.x === centerPoint.x && lastCenterPoint.y === centerPoint.y) {
        const centerX = centerPoint.x;
        const centerY = centerPoint.y;
        for (let i = 0; i < numPoints; i++) {
            const angle = (i / numPoints) * 2 * Math.PI;
            const x = centerX + radius * Math.cos(angle);
            const y = centerY + radius * Math.sin(angle);
            points.push({ X: x * contourScale, Y: y * contourScale });
        }
        // console.log('[points]', [points])
    }
    else {
        const ovalData = GetOval(new Point2(lastCenterPoint.x, lastCenterPoint.y), new Point2(centerPoint.x, centerPoint.y), radius, contourScale);
        return new Shape(ovalData, true);
    }
    return new Shape([points], true);
};
export const convertPolygonsToShape = (polygons, imageSet) => {
    if (!polygons) {
        return new Shape([], true);
    }
    // const contourScale = imageSet.contourScale
    const contourScale = 10;
    const shape = [];
    for (let k = 0, length = polygons.length; k < length; k++) {
        for (let i = 0, length = polygons[k].length; i < length; i++) {
            const point = polygons[k][i];
            if (!shape[k]) {
                shape[k] = [];
            }
            shape[k].push({ X: point[0] * contourScale, Y: point[1] * contourScale });
        }
    }
    return new Shape(shape, true);
};
export const convertShapeToPolygons = (shape, imageSet) => {
    // console.log('shape', shape)
    // const contourScale = imageSet.contourScale
    const contourScale = 10;
    const polygons = [];
    const paths = shape.paths;
    for (let k = 0, length = paths.length; k < length; k++) {
        for (let i = 0, length = paths[k].length; i < length; i++) {
            const point = paths[k][i];
            if (!polygons[k]) {
                polygons[k] = [];
            }
            polygons[k][i] = [point.X / contourScale, point.Y / contourScale];
            // shape[k].push({X: point[0], Y: point[1]})
        }
    }
    return polygons;
};
export const getScalineDataFromBrush = (radius, centerPoint) => {
    const oy = centerPoint.y;
    const ox = centerPoint.x;
    const yMin = oy - radius;
    const yMax = oy + radius;
    const dataMap = new Map();
    for (let i = yMin; i <= yMax; i++) {
        const curY = i;
        const dy = curY - oy;
        const dx = Math.sqrt(radius * radius - dy * dy);
        const start = Math.round(ox - dx);
        const end = Math.round(ox + dx);
        if (start === end) {
            dataMap.set(i, {
                start,
                end: start + 1,
            });
        }
        else {
            dataMap.set(i, {
                start,
                end,
            });
        }
    }
    return dataMap;
};
export const initBrush = (e, imageElement, info) => {
    const { drawActiveRef, directionParams, imageInfo, imageSet, brushScalineDataRef, initCenterPointRef, lastCenterPointRef, brushCenterPointRef, activeIndexRef, polygonsMapListRef, lastInPolygonIndexesRef, showIndex, } = info;
    const mx = e.offsetX;
    const my = e.offsetY;
    // const scale = imageInfo.scale || 1
    // const radius = getPixelSize((directionParams.brushSize || 5) * scale, imageSet)
    const radius = directionParams.brushSize;
    const centerPoint = viewerCore.canvasToDicom(imageElement, { x: mx, y: my });
    // if (
    //   dicomPointOverCt([centerPoint.x + radius, centerPoint.y + radius], imageSet) ||
    //   dicomPointOverCt([centerPoint.x - radius, centerPoint.y - radius], imageSet)
    // ) {
    //   return
    // }
    drawActiveRef.current = true;
    const brushCenterPoint = {
        x: radius,
        y: radius,
    };
    const polygons = polygonsMapListRef.current[activeIndexRef.current]?.data.get(showIndex);
    lastInPolygonIndexesRef.current = getInPolyonsIndex(centerPoint, polygons);
    initCenterPointRef.current = centerPoint;
    lastCenterPointRef.current = centerPoint;
    // brushScalineDataRef.current = getScalineDataFromBrush(radius, brushCenterPoint)
    brushScalineDataRef.current = generateShapeFromBrush(centerPoint, lastCenterPointRef.current, radius, 40, imageSet);
    brushCenterPointRef.current = brushCenterPoint;
};
const handleShape = (originPolygons, brushPoylgon, imageSet, drawState) => {
    const originShape = convertPolygonsToShape(originPolygons, imageSet);
    const operateTypeCollect = {
        1: 'union',
        0: 'difference',
    };
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    //@ts-ignore
    const newShape = originShape[operateTypeCollect[drawState]](brushPoylgon);
    const polygons = convertShapeToPolygons(newShape, imageSet);
    return polygons;
};
export const doBrush = (e, imageElement, info) => {
    const { drawActiveRef, directionParams, imageInfo, imageSet, brushCenterPointRef, brushScalineDataRef, showIndex, scanlineMapListRef, initCenterPointRef, activeRoi: roi, changedPolygon, contourWorker, uuid, lastCenterPointRef, polygonsMapListRef, drawStateRef, activeIndexRef, lastInPolygonIndexesRef, } = info;
    const mx = e.offsetX;
    const my = e.offsetY;
    const centerPoint = viewerCore.canvasToDicom(imageElement, { x: mx, y: my });
    const activeRoiIndex = activeIndexRef.current;
    const polygonMapData = polygonsMapListRef.current[activeRoiIndex]?.data;
    // console.log('polygonMapData', polygonMapData)
    if (!polygonMapData) {
        return;
    }
    const polygons = polygonMapData.get(showIndex);
    const indexes = drawBrushImg(e, centerPoint, imageElement, roi, polygons, info);
    // const shape = convertPolygonsToShape(polygons, imageSet)
    const radius = directionParams.brushSize;
    // if (
    //   dicomPointOverCt([centerPoint.x + radius, centerPoint.y + radius], imageSet) ||
    //   dicomPointOverCt([centerPoint.x - radius, centerPoint.y - radius], imageSet)
    // ) {
    //   return
    // }
    if (drawActiveRef.current) {
        // todo:没必要每次生成，改成平移的方式提升性能
        brushScalineDataRef.current = generateShapeFromBrush(centerPoint, lastCenterPointRef.current, radius, 40, imageSet);
        const scale = imageInfo.scale || 1;
        const w = imageInfo.width || 512;
        const h = imageInfo.height || 512;
        const brushCenterPoint = brushCenterPointRef.current;
        const lastCenterPoint = lastCenterPointRef.current;
        const diffX = centerPoint.x - lastCenterPoint.x;
        const diffY = centerPoint.y - lastCenterPoint.y;
        // if (Math.abs(diffX * scale) > radius || Math.abs(diffY * scale) > radius) {
        //   return
        // }
        lastCenterPointRef.current = centerPoint;
        // const dx = Math.round(centerPoint.x * scale) - brushCenterPoint.x
        // const dy = Math.round(centerPoint.y * scale) - brushCenterPoint.y
        // console.log('dx', dx, dy)
        // if (dx < 0 || dy < 0) {
        //   return
        // }
        const brushScalineData = brushScalineDataRef.current;
        let result = handleShape(polygons, brushScalineData, imageSet, drawStateRef.current);
        if (directionParams.removeHoles &&
            lastInPolygonIndexesRef.current.length === 1 &&
            result.length > polygons.length) {
            const lastInPolygon = polygons[lastInPolygonIndexesRef.current[0]];
            const lastPolygonMap = {};
            const lastPolygonLen = lastInPolygon.length;
            for (let i = 0; i < lastPolygonLen; i++) {
                const point = [Math.round(lastInPolygon[i][0] * 100), Math.round(lastInPolygon[i][1] * 100)];
                if (!lastPolygonMap[point[0]]) {
                    lastPolygonMap[point[0]] = {
                        [point[1]]: true,
                    };
                }
                else {
                    lastPolygonMap[point[0]][point[1]] = true;
                }
            }
            const deletePolygonIndexs = [];
            for (let i = 0, resultLength = result.length; i < resultLength; i++) {
                const polygon = result[i];
                const length = polygon.length;
                for (let j = 0; j < length; j++) {
                    const point = [Math.round(polygon[j][0] * 100), Math.round(polygon[j][1] * 100)];
                    if (lastPolygonMap[point[0]] && lastPolygonMap[point[0]][point[1]]) {
                        deletePolygonIndexs.push(i);
                        break;
                    }
                }
            }
            if (deletePolygonIndexs.length > 1) {
                const deleteIndexs = deletePolygonIndexs.slice(1, deletePolygonIndexs.length);
                result = result.filter((polygon, index) => !deleteIndexs.includes(index));
                // const newScalne = polygonsToScanline(wasmModule, polygons, 1, width || 512, height || 512)
                // self.postMessage({
                //   uuid,
                //   roiIndex,
                //   index,
                //   polygons,
                //   scanline: newScalne,
                //   removeHole,
                //   workerEvent: WorkerEvents.onSmartBrushPolygonsAndScanlineGet,
                // })
            }
        }
        polygonMapData.set(showIndex, result);
        changedPolygon({ regenerateOffscreen: false });
        if (centerPoint.x === initCenterPointRef.current.x && centerPoint.y === initCenterPointRef.current.y) {
            lastInPolygonIndexesRef.current = getInPolyonsIndex(centerPoint, result || []);
        }
        // lastInPolygonIndexesRef.current = indexes
        // const len = brushScalineData.size
        // todo：remove hole 要判断是否新增了多边形，若新增了，判断这次多边形比上次多边形少了哪些点(map记录)以及这些点与环是否重合（超过10个点），如果重合则删除,同时点再 maxX,maxY、minX、minY 外直接排除
        // if (drawStateRef.current === 1) {
        //   // for (let i = 0; i < len; i++) {
        //   //   const data = brushScalineData.get(i)
        //   //   const newY = i + dy
        //   //   if (!invPointMap.has(newY)) {
        //   //     invPointMap.set(newY, [])
        //   //   }
        //   //   const start = data.start + dx
        //   //   const end = data.end + dx
        //   //   drawRange(start, end, w, h, scale, invPointMap.get(newY))
        //   // }
        //   // const brushScalineData1 = generateShapeFromBrush(centerPoint.x + 100, centerPoint.y, 100, 100)
        //   // const union = shape.union(brushScalineData)
        //   // const union = shape
        //   // console.log('brushScalineDataRef', brushScalineDataRef.current, shape, union)
        //   // const result = convertShapeToPolygons(union)
        //   // console.log('result', result)
        //   // polygonMapData.set(showIndex, result)
        //   // setTimeout(() => {
        //   //   console.log('xxx')
        //   changedPolygon()
        //   // }, 0)
        // } else {
        //   // for (let i = 0; i < len; i++) {
        //   //   const data = brushScalineData.get(i)
        //   //   const newY = i + dy
        //   //   eraseRange(data.start + dx, data.end + dx, invPointMap.get(newY))
        //   // }
        // }
        // const {width, height} = imageInfo
        // console.log('invPointMap', invPointMap, scale, width)
        // if (directionParams.removeHoles && lastInPolygonIndexesRef.current.length === 1) {
        //   const lastInPolygon = polygons[lastInPolygonIndexesRef.current[0]]
        //   contourWorker.postMessage({
        //     workerEvent: WorkerEvents.getPolygonByRoiAndIndex,
        //     index: showIndex,
        //     roiIndex: activeRoiIndex,
        //     removeHole: true,
        //     lastCenterPoint,
        //     lastInPolygon,
        //     lastPolygonsLength: polygons.length,
        //     scanline: invPointMap,
        //     width: width,
        //     height: height,
        //     uuid,
        //   })
        // } else {
        //   contourWorker.postMessage({
        //     workerEvent: WorkerEvents.getPolygonByRoiAndIndex,
        //     roiIndex: activeRoiIndex,
        //     index: showIndex,
        //     scanline: invPointMap,
        //     width: width,
        //     height: height,
        //     uuid,
        //   })
        // }
        // lastInPolygonIndexesRef.current = indexes
    }
};
// remove holes 【maxX, x],[x,maxY]、[minX, y]、[x,minY] 皆在多边形内则为环，否则不为环
export const drawBrushImg = (e, pt, imageElement, roi, polygons, info) => {
    const { directionParams, imageInfo, showAsHFS, imageSet, drawStateRef, drawActiveRef } = info;
    const indexes = getInPolyonsIndex(pt, polygons || []);
    // console.log('pt', pt, polygons)
    if (!drawActiveRef.current) {
        drawStateRef.current = getBrushStatus(polygons || [], indexes, directionParams.drawMode);
    }
    const brushSize = directionParams.brushSize || 5;
    // const brushSize = 500
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (ctx) {
        const radius = getCanvasSize(brushSize, imageSet, imageElement, undefined, showAsHFS);
        // const radius = 100
        canvas.width = radius * 2;
        canvas.height = radius * 2;
        ctx.beginPath();
        ctx.imageSmoothingEnabled = true;
        ctx.arc(radius, radius, radius - 1, 0, Math.PI * 2, false);
        ctx.moveTo(radius - 5, radius);
        ctx.lineTo(radius + 5, radius);
        if (drawStateRef.current === 1) {
            ctx.moveTo(radius, radius - 5);
            ctx.lineTo(radius, radius + 5);
        }
        ctx.strokeStyle = `rgb(${roi.color})`;
        ctx.lineWidth = roi.lineWidth || 2;
        ctx.stroke();
        ctx.closePath();
        const url = canvas.toDataURL('image/png');
        let img = document.querySelector('.contour-cursor');
        if (img) {
            img.src = url;
        }
        else {
            img = document.createElement('img');
            img.className = 'contour-cursor';
            img.src = url;
            imageElement.appendChild(img);
        }
        if (e) {
            img.style.top = `${e.offsetY - radius - 1}px`;
            img.style.left = `${e.offsetX - radius - 1}px`;
        }
        img.style.visibility = 'visible';
    }
    return indexes;
};
/**
 * 获得笔刷类型
 */
export const getBrushStatus = (polygons, indexes, drawMode) => {
    if (drawMode === 'erase') {
        return 0;
    }
    if (!polygons || polygons.length === 0) {
        return 1;
    }
    // if (indexes.length === 0 && drawMode === 'draw') {
    //   return 1
    // }
    if (drawMode === 'draw') {
        return 1;
    }
    return indexes.length % 2;
};
export const getInPolyonsIndex = (pt, polygons) => {
    if (!polygons || polygons.length === 0) {
        return [];
    }
    const len = polygons.length;
    const indexes = [];
    for (let i = 0; i < len; i++) {
        // if (isPointInPolygon({x: -36.560984181497744, y: 57.4215632163331}, polygons[i])) {
        //   indexes.push(i)
        // }
        if (isPointInPolygon(pt, polygons[i])) {
            indexes.push(i);
        }
    }
    // console.log('indexes', indexes, pt)
    return indexes;
};
//# sourceMappingURL=brush-example.js.map