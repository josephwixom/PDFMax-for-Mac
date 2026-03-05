import { Line } from 'fabric';
import type { ScaleConfig, MeasureUnit } from '@pdfmax/shared';

export class CalibrationManager {
    private scales: Map<number, ScaleConfig> = new Map();

    getScale(pageNumber: number): ScaleConfig | undefined {
        return this.scales.get(pageNumber);
    }

    setScale(pageNumber: number, config: ScaleConfig) {
        this.scales.set(pageNumber, config);
    }

    /**
     * Calculate pixelsPerUnit from a drawn calibration line.
     * @param pixelLength - Length of the drawn line in canvas pixels
     * @param realWorldLength - The actual real-world length the user typed
     * @param unit - The unit of measurement chosen
     */
    computeAndSet(pageNumber: number, pixelLength: number, realWorldLength: number, unit: MeasureUnit) {
        const pixelsPerUnit = pixelLength / realWorldLength;
        const label = `${realWorldLength}${unit} drawn`;
        this.setScale(pageNumber, { pixelsPerUnit, unit, label });
        return { pixelsPerUnit, unit, label };
    }

    /**
     * Convert a pixel distance to real-world units using the stored scale.
     */
    toRealWorld(pageNumber: number, pixels: number): string {
        const config = this.scales.get(pageNumber);
        if (!config) return `${pixels.toFixed(0)}px (uncalibrated)`;
        const realValue = pixels / config.pixelsPerUnit;
        return `${realValue.toFixed(2)} ${config.unit}`;
    }

    /**
     * Convert a pixel area to real-world area using the stored scale.
     */
    areaToRealWorld(pageNumber: number, pixelArea: number): string {
        const config = this.scales.get(pageNumber);
        if (!config) return `${pixelArea.toFixed(0)}px² (uncalibrated)`;
        const realArea = pixelArea / (config.pixelsPerUnit * config.pixelsPerUnit);
        return `${realArea.toFixed(2)} ${config.unit}²`;
    }
}
