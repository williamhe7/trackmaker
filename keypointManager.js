// keypointManager.js
export class KeypointManager {
    constructor() {
        this.w = 1600;
        this.h = 1200;
        this.scale_dict = { 2: 1.07939633, 3: 2.15879265, 4: 3.23818898, 5: 4.31758530, 6: 5.39698163, 7: 6.47637795 };
        this.keys = [];
        this.homography = [];
        this.source = [];
        this.scale_factor = 1;
        this.scaled_width = 800;
        this.scaled_height = 300;
    }

    async getKeypoints(videoElement, session) {
        if (!session) return [];

        const inputSize = 1600;
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = inputSize;
        tempCanvas.height = inputSize;
        const tctx = tempCanvas.getContext('2d', { willReadFrequently: true });
        tctx.drawImage(videoElement, 0, 0, inputSize, inputSize);

        const imageData = tctx.getImageData(0, 0, inputSize, inputSize);
        const data = new Float32Array(3 * inputSize * inputSize);

        for (let i = 0; i < inputSize * inputSize; i++) {
            const idx = i * 4;
            data[i] = imageData.data[idx] / 255.0;           // R
            data[i + inputSize * inputSize] = imageData.data[idx + 1] / 255.0; // G
            data[i + 2 * inputSize * inputSize] = imageData.data[idx + 2] / 255.0; // B
        }

        const tensor = new ort.Tensor('float32', data, [1, 3, inputSize, inputSize]);
        const results = await session.run({ images: tensor });
        const output = results.output0.data; // [1, 300, 12] -> flattened

        return this.postProcessYOLOPose(output, inputSize);
    }

    postProcessYOLOPose(rawOutput, imgSize = 1600) {
        const numDets = 300;
        const featDim = 12;
        const detections = [];

        for (let i = 0; i < numDets; i++) {
            const offset = i * featDim;
            const conf = rawOutput[offset + 4];
            if (conf < 0.25) continue;

            // Assuming format: [x_center?, y?, ... , conf, cls, kpt_x1, kpt_y1, kpt_x2, kpt_y2, ...]
            const kpts = [];
            for (let k = 6; k < featDim; k += 2) {  // start after bbox+conf+cls
                const x = rawOutput[offset + k];
                const y = rawOutput[offset + k + 1];
                if (x > 0 && y > 0) kpts.push([x, y]);
            }

            if (kpts.length >= 2) detections.push(kpts);
        }

        // Sort by lowest x (as in Python)
        return this.sortByLowestX(detections);
    }

    sortByLowestX(kpps) {
        return kpps.sort((a, b) => {
            const minA = Math.min(...a.map(p => p[0]));
            const minB = Math.min(...b.map(p => p[0]));
            return minA - minB;
        });
    }

    computeHomography(keys, targetH = 1200) {
        this.homography = [];
        this.source = [];
        this.keys = keys || [];

        if (keys.length < 2) return;

        for (let i = 0; i < keys.length - 1; i++) {
            const group1 = keys[i];
            const group2 = keys[i + 1];

            const lt = group1[0];  // left top
            const lb = group1[1];  // left bottom
            const rt = group2[0];
            const rb = group2[1];

            const srcPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
                lt[0], lt[1], rt[0], rt[1], rb[0], rb[1], lb[0], lb[1]
            ]);

            const dstWidth = 800; // adjustable
            const dstPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
                0, 0, dstWidth - 1, 0, dstWidth - 1, targetH - 1, 0, targetH - 1
            ]);

            const H = cv.getPerspectiveTransform(srcPoints, dstPoints);
            this.homography.push(H);
            this.source.push(srcPoints);
        }

        this.scale_factor = this.scale_dict[keys.length] || 1.0;
    }

    // Full port of transformImage using OpenCV.js
    transformImage(frameMat) {
        if (this.homography.length === 0) return frameMat;

        const h = this.h;
        const imgList = [];

        for (let i = 0; i < this.homography.length; i++) {
            const H = this.homography[i];
            const src = this.source[i];

            // Warp full image
            let warped = new cv.Mat();
            cv.warpPerspective(frameMat, warped, H, new cv.Size(this.w * 2, h * 2), cv.INTER_LINEAR);

            // Project source points to find crop region
            let transformed = new cv.Mat();
            cv.perspectiveTransform(src, transformed, H);

            const pts = transformed.data32F;
            let xMin = Math.max(0, Math.floor(Math.min(pts[0], pts[2], pts[4], pts[6])));
            let xMax = Math.min(warped.cols, Math.ceil(Math.max(pts[0], pts[2], pts[4], pts[6])));

            // Crop
            let rect = new cv.Rect(xMin, 0, xMax - xMin, warped.rows);
            let cropped = warped.roi(rect);

            // Resize height
            let resized = new cv.Mat();
            cv.resize(cropped, resized, new cv.Size(cropped.cols, h), 0, 0, cv.INTER_LINEAR);

            imgList.push(resized);

            // Cleanup
            warped.delete(); cropped.delete(); transformed.delete();
        }

        if (imgList.length === 0) return frameMat;

        // Horizontal concat
        let combined = imgList[0];
        for (let j = 1; j < imgList.length; j++) {
            let temp = new cv.Mat();
            cv.hconcat(combined, imgList[j], temp);
            combined.delete();
            combined = temp;
            imgList[j].delete();
        }

        // Final resize + rotate 180
        let finalH = Math.round(combined.cols / this.scale_factor);
        let resizedFinal = new cv.Mat();
        cv.resize(combined, resizedFinal, new cv.Size(combined.cols, finalH), 0, 0, cv.INTER_CUBIC);

        let rotated = new cv.Mat();
        cv.rotate(resizedFinal, rotated, cv.ROTATE_180);

        // Scale to screen (simplified)
        this.scaled_width = Math.round(rotated.cols * 0.6);
        this.scaled_height = Math.round(rotated.rows * 0.6);

        let finalMat = new cv.Mat();
        cv.resize(rotated, finalMat, new cv.Size(this.scaled_width, this.scaled_height));

        // Cleanup
        combined.delete(); resizedFinal.delete(); rotated.delete();

        return finalMat;
    }
}
