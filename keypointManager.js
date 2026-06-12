// keypointManager.js
export class KeypointManager {
    constructor() {
        this.w = 1600;
        this.h = 1200;

        this.scale_dict = {
            2: 1.07939633,
            3: 2.15879265,
            4: 3.23818898,
            5: 4.31758530,
            6: 5.39698163,
            7: 6.47637795
        };

        this.keys = [];
        this.homography = [];  // array of Mats
        this.source = [];      // array of Mats
        this.scale_factor = 1;

        this.scaled_width = 800;
        this.scaled_height = 300;
    }

    // ----------------------------
    // MODEL INFERENCE (unchanged)
    // ----------------------------
    async get_kpps(videoElement, session) {
        if (!session) return [];

        const INPUT_SIZE = 1600;

        const ratio = Math.min(
            INPUT_SIZE / videoElement.videoWidth,
            INPUT_SIZE / videoElement.videoHeight
        );

        const newW = Math.round(videoElement.videoWidth * ratio);
        const newH = Math.round(videoElement.videoHeight * ratio);

        const padX = (INPUT_SIZE - newW) / 2;
        const padY = (INPUT_SIZE - newH) / 2;

        const canvas = document.createElement("canvas");
        canvas.width = INPUT_SIZE;
        canvas.height = INPUT_SIZE;

        const ctx = canvas.getContext("2d", { willReadFrequently: true });

        ctx.fillStyle = "rgb(114,114,114)";
        ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);

        ctx.drawImage(videoElement, padX, padY, newW, newH);

        const imageData = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);

        const area = INPUT_SIZE * INPUT_SIZE;
        const inputData = new Float32Array(3 * area);

        for (let i = 0; i < area; i++) {
            const p = i * 4;
            inputData[i] = imageData.data[p] / 255.0;
            inputData[i + area] = imageData.data[p + 1] / 255.0;
            inputData[i + area * 2] = imageData.data[p + 2] / 255.0;
        }

        const tensor = new ort.Tensor("float32", inputData, [
            1, 3, INPUT_SIZE, INPUT_SIZE
        ]);

        let results;
        try {
            results = await session.run({ images: tensor });
        } catch {
            const inputName = session.inputNames[0];
            results = await session.run({ [inputName]: tensor });
        }

        const output = results.output0 || Object.values(results)[0];

        return this.sort_by_lowest_x(
            this.postProcessYOLOPose(output.data, ratio, padX, padY)
        );
    }

    postProcessYOLOPose(rawOutput, scale, padX, padY) {
        const detections = [];
        const CONF_THRESHOLD = 0.5;
        const VALUES_PER_DETECTION = 12;

        const numDetections = Math.floor(rawOutput.length / VALUES_PER_DETECTION);

        for (let i = 0; i < numDetections; i++) {
            const o = i * VALUES_PER_DETECTION;
            const conf = rawOutput[o + 4];
            if (conf < CONF_THRESHOLD) continue;

            let kp1x = rawOutput[o + 6];
            let kp1y = rawOutput[o + 7];
            let kp2x = rawOutput[o + 9];
            let kp2y = rawOutput[o + 10];

            kp1x = (kp1x - padX) / scale;
            kp1y = (kp1y - padY) / scale;
            kp2x = (kp2x - padX) / scale;
            kp2y = (kp2y - padY) / scale;

            if (![kp1x, kp1y, kp2x, kp2y].every(Number.isFinite)) continue;

            detections.push([[kp1x, kp1y], [kp2x, kp2y]]);
        }

        return detections;
    }

    sort_by_lowest_x(kpps) {
        return (kpps || []).sort((a, b) => {
            const minA = Math.min(a[0][0], a[1][0]);
            const minB = Math.min(b[0][0], b[1][0]);
            return minA - minB;
        });
    }

    // ----------------------------
    // BATCHED HOMOGRAPHY - ONE PER KEY SEGMENT
    // ----------------------------
    compute_homography(keys, targetH = 1200) {
        this.keys = keys || [];
        this.homography = [];
        this.source = [];

        if (this.keys.length < 2) {
            this.scale_factor = 1;
            return;
        }

        const capped = this.keys.slice(0, 7);

        for (let i = 0; i < capped.length - 1; i++) {
            const lt = capped[i][0];
            const lb = capped[i][1];
            const rt = capped[i + 1][0];
            const rb = capped[i + 1][1];

            const srcMat = cv.matFromArray(4, 1, cv.CV_32FC2, [
                lt[0], lt[1],
                rt[0], rt[1],
                rb[0], rb[1],
                lb[0], lb[1]
            ]);

            const width = Math.max(
                Math.hypot(rt[0] - lt[0], rt[1] - lt[1]),
                Math.hypot(rb[0] - lb[0], rb[1] - lb[1])
            );

            const dstMat = cv.matFromArray(4, 1, cv.CV_32FC2, [
                0, 0,
                width - 1, 0,
                width - 1, targetH - 1,
                0, targetH - 1
            ]);

            const H = cv.getPerspectiveTransform(srcMat, dstMat);

            this.source.push(srcMat);
            this.homography.push(H);

            dstMat.delete();
        }

        this.scale_factor = this.scale_dict[capped.length] || 1;
    }

    // ----------------------------
    // TRANSFORM - PER-SEGMENT WARP + STITCH
    // ----------------------------
    transformImage(videoElement) {
        if (!videoElement || this.keys.length < 2 || this.homography.length === 0) {
            return null;
        }

        const frameCanvas = document.createElement("canvas");
        frameCanvas.width = videoElement.videoWidth;
        frameCanvas.height = videoElement.videoHeight;

        const ctx = frameCanvas.getContext("2d");
        ctx.drawImage(videoElement, 0, 0);

        const src = cv.imread(frameCanvas);
        const imgList = [];

        try {
            for (let i = 0; i < this.homography.length; i++) {
                const H = this.homography[i];
                const sourceMat = this.source[i];

                const warped = new cv.Mat();
                cv.warpPerspective(
                    src,
                    warped,
                    H,
                    new cv.Size(src.cols * 2, src.rows * 2)
                );

                // Get bounding box for this segment
                const transformed = new cv.Mat();
                cv.perspectiveTransform(sourceMat, transformed, H);

                const pts = transformed.data32F;
                let minX = Infinity;
                let maxX = -Infinity;

                for (let j = 0; j < pts.length; j += 2) {
                    minX = Math.min(minX, pts[j]);
                    maxX = Math.max(maxX, pts[j]);
                }

                const xMin = Math.max(0, Math.floor(minX));
                const xMax = Math.min(warped.cols, Math.ceil(maxX));

                const roi = warped.roi(new cv.Rect(xMin, 0, xMax - xMin, warped.rows));

                const resizedToH = new cv.Mat();
                cv.resize(
                    roi,
                    resizedToH,
                    new cv.Size(roi.cols, this.h),
                    0, 0, cv.INTER_LINEAR
                );

                imgList.push(resizedToH);

                // Cleanup per segment
                roi.delete();
                warped.delete();
                transformed.delete();
            }

            // Horizontally combine all segments
            let combined = imgList[0];
            for (let i = 1; i < imgList.length; i++) {
                const temp = new cv.Mat();
                cv.hconcat(combined, imgList[i], temp);
                combined.delete();
                combined = temp;
            }

            // Final height adjustment using scale_factor
            const finalH = Math.round(combined.cols / this.scale_factor);

            const resized = new cv.Mat();
            cv.resize(
                combined,
                resized,
                new cv.Size(combined.cols, finalH),
                0, 0, cv.INTER_CUBIC
            );

            const rotated = new cv.Mat();
            cv.rotate(resized, rotated, cv.ROTATE_180);

            const outputCanvas = document.createElement("canvas");
            outputCanvas.width = rotated.cols;
            outputCanvas.height = rotated.rows;
            cv.imshow(outputCanvas, rotated);

            this.scaled_width = rotated.cols;
            this.scaled_height = rotated.rows;

            // Cleanup
            imgList.forEach(mat => mat.delete());
            combined.delete();
            resized.delete();
            rotated.delete();
            src.delete();

            return outputCanvas;

        } catch (err) {
            console.error("Transform error:", err);
            src.delete();
            return null;
        }
    }
}
