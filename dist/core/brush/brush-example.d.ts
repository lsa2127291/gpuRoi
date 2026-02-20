import { IROI } from '..';
import Shape from '@doodle3d/clipper-js';
import { ImageSet } from '@/services/imageSet';
export interface IPoint {
    x: number;
    y: number;
}
export interface IPoint3d {
    x: number;
    y: number;
    z: number;
}
export declare const generateShapeFromBrush: (centerPoint: IPoint, lastCenterPoint: IPoint, radius: number, numPoints: number, imageSet: ImageSet) => any;
export declare const convertPolygonsToShape: (polygons: number[][][], imageSet: ImageSet) => any;
export declare const convertShapeToPolygons: (shape: Shape, imageSet: ImageSet) => number[][][];
export declare const getScalineDataFromBrush: (radius: number, centerPoint: IPoint) => Map<any, any>;
export declare const initBrush: (e: MouseEvent, imageElement: any, info: Record<string, any>) => void;
export declare const doBrush: (e: MouseEvent, imageElement: any, info: Record<string, any>) => void;
export declare const drawBrushImg: (e: MouseEvent, pt: IPoint, imageElement: any, roi: IROI, polygons: number[][][] | undefined, info: Record<string, any>) => number[];
/**
 * 获得笔刷类型
 */
export declare const getBrushStatus: (polygons: number[][][], indexes: number[], drawMode: string) => number;
export declare const getInPolyonsIndex: (pt: IPoint, polygons: number[][][]) => number[];
//# sourceMappingURL=brush-example.d.ts.map