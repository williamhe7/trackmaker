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
        this.homography = [];
        this.source = [];
        this.scale_factor = 1;

        this.scaled_width = 800;
        this.scaled_height = 300;

        this.frameCanvas = document.createElement("canvas");
        this.frameCtx = this.frameCanvas.getContext("2d");
        this.srcMat = null;this.frameCanvas = document.createElement("canvas");
        this.frameCtx = this.frameCanvas.getContext("2d");
        this.srcMat = null;
    }

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
            inputData[i] = imageData.data[p] / 255;
            inputData[i + area] = imageData.data[p + 1] / 255;
            inputData[i + 2 * area] = imageData.data[p + 2] / 255;
        }

        const tensor = new ort.Tensor("float32", inputData, [1, 3, INPUT_SIZE, INPUT_SIZE]);

        let results;
        try {
            results = await session.run({ images: tensor });
        } catch {
            results = await session.run({ [session.inputNames[0]]: tensor });
        }

        const output = results.output0 || Object.values(results)[0];

        return this.sort_by_lowest_x(
            this.postProcessYOLOPose(output.data, ratio, padX, padY)
        );
    }

    postProcessYOLOPose(raw, scale, padX, padY) {
        const out = [];
        const stride = 12;

        for (let i = 0; i < raw.length / stride; i++) {
            const o = i * stride;
            const conf = raw[o + 4];
            if (conf < 0.25) continue;

            let x1 = (raw[o + 6] - padX) / scale;
            let y1 = (raw[o + 7] - padY) / scale;
            let x2 = (raw[o + 9] - padX) / scale;
            let y2 = (raw[o + 10] - padY) / scale;

            out.push([[x1, y1], [x2, y2]]);
        }

        return out;
    }

    sort_by_lowest_x(kpps) {
        if (!kpps) return [];
        return kpps.sort((a, b) =>
            Math.min(a[0][0], a[1][0]) - Math.min(b[0][0], b[1][0])
        );
    }

    compute_homography(keys, targetH = 1200) {
        this.homography = [];
        this.source = [];
        this.keys = keys;

        if (keys.length < 2) return;

        const limited = keys.slice(0, 7);

        for (let i = 0; i < limited.length - 1; i++) {
            const g1 = limited[i];
            const g2 = limited[i + 1];

            const src = cv.matFromArray(4, 1, cv.CV_32FC2, [
                g1[0][0], g1[0][1],
                g2[0][0], g2[0][1],
                g2[1][0], g2[1][1],
                g1[1][0], g1[1][1]
            ]);

            const dst = cv.matFromArray(4, 1, cv.CV_32FC2, [
                0, 0,
                800, 0,
                800, targetH,
                0, targetH
            ]);

            this.homography.push(cv.getPerspectiveTransform(src, dst));
            this.source.push(src);
        }

        this.scale_factor = this.scale_dict[keys.length] || 1;
    }

    // ================================
    // FIXED + MOBILE OPTIMIZED
    // ================================
    transformImage(videoElement) {
    
        if (!videoElement || this.homography.length === 0) return null;
    
        // =========================
        // 1. Reuse canvas (NO ALLOCATION)
        // =========================
        this.frameCtx.drawImage(videoElement, 0, 0);
    
        // =========================
        // 2. Reuse srcMat if possible
        // =========================
        if (!this.srcMat) {
            this.srcMat = cv.imread(this.frameCanvas);
        } else {
            this.srcMat.data.set(
                cv.imread(this.frameCanvas).data
            );
        }
    
        const src = this.srcMat;
    
        let parts = [];
    
        const warpSize = new cv.Size(
            src.cols * 1.1,
            src.rows * 1.1
        );
    
        // =========================
        // 3. Main loop (minimal allocations)
        // =========================
        for (let i = 0; i < this.homography.length; i++) {
    
            const H = this.homography[i];
    
            const warped = new cv.Mat();
            cv.warpPerspective(src, warped, H, warpSize);
    
            const pts = new cv.Mat();
            cv.perspectiveTransform(this.source[i], pts, H);
    
            const data = pts.data32F;
    
            let minX = 1e9;
            let maxX = -1e9;
    
            for (let j = 0; j < data.length; j += 2) {
                const x = data[j];
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
            }
    
            pts.delete();
    
            const x0 = Math.max(0, minX | 0);
            const x1 = Math.min(warped.cols, maxX | 0);
    
            if (x1 - x0 < 10) {
                warped.delete();
                continue;
            }
    
            const roi = warped.roi(new cv.Rect(x0, 0, x1 - x0, warped.rows));
    
            const resized = new cv.Mat();
            cv.resize(roi, resized, new cv.Size(roi.cols, this.h));
    
            roi.delete();
            warped.delete();
    
            parts.push(resized);
    
            // =========================
            // FPS CONTROL POINT (IMPORTANT)
            // =========================
            if (parts.length > 6) break; // hard cap for mobile FPS
        }
    
        if (parts.length === 0) return null;
    
        // =========================
        // 4. Safe concat (no MatVector)
        // =========================
        let combined = parts[0];
    
        for (let i = 1; i < parts.length; i++) {
            const dst = new cv.Mat();
            cv.hconcat(combined, parts[i], dst);
    
            combined.delete();
            parts[i].delete();
    
            combined = dst;
        }
    
        // =========================
        // 5. Final lightweight resize
        // =========================
        const finalH = Math.max(1, (combined.cols / this.scale_factor) | 0);
    
        const resized = new cv.Mat();
        cv.resize(combined, resized, new cv.Size(combined.cols, finalH));
    
        const rotated = new cv.Mat();
        cv.rotate(resized, rotated, cv.ROTATE_180);
    
        const out = document.createElement("canvas");
        out.width = rotated.cols;
        out.height = rotated.rows;
    
        cv.imshow(out, rotated);
    
        // =========================
        // 6. Cleanup
        // =========================
        src.delete();          // IMPORTANT (avoid leak)
        combined.delete();
        resized.delete();
        rotated.delete();
    
        return out;
    }
}
