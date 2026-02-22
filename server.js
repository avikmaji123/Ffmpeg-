const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = process.env.PORT || 3000;

// Initialize Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 20MB Upload Limit
const upload = multer({ dest: '/tmp/', limits: { fileSize: 20 * 1024 * 1024 } });

// ==========================================
// CORE HELPERS & ERROR HANDLING
// ==========================================

// Safely delete files from the local server
const cleanupFiles = (files) => {
    files.forEach(file => {
        if (file && fs.existsSync(file)) fs.unlinkSync(file);
    });
};

// Upload to Supabase and return the public URL
const uploadToSupabase = async (localFilePath, fileName) => {
    const fileBuffer = fs.readFileSync(localFilePath);
    const { error } = await supabase.storage.from('videos').upload(fileName, fileBuffer, {
        contentType: 'video/mp4',
        upsert: true
    });
    if (error) throw error;
    const { data } = supabase.storage.from('videos').getPublicUrl(fileName);
    return data.publicUrl;
};

// The Master Processing Wrapper: Handles memory limits, uploads, and error cleanups
const processAndUpload = (res, ffmpegCommand, outputPath, inputFiles) => {
    ffmpegCommand
        // CRITICAL FOR FREE TIER: Restricts CPU threads to prevent Out of Memory crashes
        .outputOptions(['-threads 1', '-preset ultrafast']) 
        .on('end', async () => {
            try {
                const publicUrl = await uploadToSupabase(outputPath, path.basename(outputPath));
                res.json({ success: true, downloadUrl: publicUrl });
            } catch (err) {
                console.error('Supabase Error:', err.message);
                res.status(500).json({ error: 'Processing succeeded, but cloud upload failed.', details: err.message });
            } finally {
                // ALWAYS clean up files, even if upload fails
                cleanupFiles([...inputFiles, outputPath]);
            }
        })
        .on('error', (err) => {
            console.error('FFmpeg Error:', err.message);
            cleanupFiles([...inputFiles, outputPath]); // Delete corrupted/incomplete files
            res.status(500).json({ error: 'Video processing failed.', details: err.message });
        })
        .save(outputPath);
};

// ==========================================
// API ENDPOINTS
// ==========================================

// 1. TRIM
app.post('/trim', upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Video file required.' });
    const { startTime = 0, duration = 5 } = req.body;
    const outputPath = `/tmp/trimmed_${Date.now()}.mp4`;

    const cmd = ffmpeg(req.file.path)
        .setStartTime(startTime)
        .setDuration(duration)
        .outputOptions('-c copy'); // Copy codec saves massive RAM

    processAndUpload(res, cmd, outputPath, [req.file.path]);
});

// 2. CROP
app.post('/crop', upload.single('video'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Video file required.' });
    const { w = 1080, h = 1920, x = 0, y = 0 } = req.body;
    const outputPath = `/tmp/cropped_${Date.now()}.mp4`;

    const cmd = ffmpeg(req.file.path).videoFilters(`crop=${w}:${h}:${x}:${y}`);
    processAndUpload(res, cmd, outputPath, [req.file.path]);
});

// 3. ADD VOICE / AUDIO
app.post('/add-voice', upload.fields([{ name: 'video', maxCount: 1 }, { name: 'audio', maxCount: 1 }]), (req, res) => {
    if (!req.files.video || !req.files.audio) return res.status(400).json({ error: 'Video and Audio files required.' });
    const outputPath = `/tmp/voiced_${Date.now()}.mp4`;

    const cmd = ffmpeg(req.files.video[0].path)
        .addInput(req.files.audio[0].path)
        .outputOptions(['-c:v copy', '-map 0:v:0', '-map 1:a:0', '-shortest']);

    processAndUpload(res, cmd, outputPath, [req.files.video[0].path, req.files.audio[0].path]);
});

// 4. ADD CAPTIONS
app.post('/add-caption', upload.fields([{ name: 'video', maxCount: 1 }, { name: 'subtitle', maxCount: 1 }]), (req, res) => {
    if (!req.files.video || !req.files.subtitle) return res.status(400).json({ error: 'Video and .srt Subtitle files required.' });
    const outputPath = `/tmp/captioned_${Date.now()}.mp4`;
    const subPath = path.resolve(req.files.subtitle[0].path);

    const cmd = ffmpeg(req.files.video[0].path).videoFilters(`subtitles=${subPath}`);
    processAndUpload(res, cmd, outputPath, [req.files.video[0].path, subPath]);
});

// 5. MERGE (Handled slightly differently in fluent-ffmpeg)
app.post('/merge', upload.array('videos', 2), (req, res) => {
    if (!req.files || req.files.length !== 2) return res.status(400).json({ error: 'Exactly 2 videos required.' });
    const outputPath = `/tmp/merged_${Date.now()}.mp4`;
    const inputPaths = req.files.map(f => f.path);

    let cmd = ffmpeg();
    inputPaths.forEach(p => cmd.input(p));

    cmd.outputOptions(['-threads 1', '-preset ultrafast'])
        .on('end', async () => {
            try {
                const url = await uploadToSupabase(outputPath, path.basename(outputPath));
                res.json({ success: true, downloadUrl: url });
            } catch (err) {
                res.status(500).json({ error: 'Cloud upload failed.', details: err.message });
            } finally {
                cleanupFiles([...inputPaths, outputPath]);
            }
        })
        .on('error', (err) => {
            cleanupFiles([...inputPaths, outputPath]);
            res.status(500).json({ error: 'Merge failed.', details: err.message });
        })
        .mergeToFile(outputPath, '/tmp/');
});

// ==========================================
// BACKGROUND AUTOMATION & DOCS
// ==========================================

// UptimeRobot Health Check
app.get('/health', (req, res) => res.status(200).send('OK'));

// Supabase Auto-Delete Cron Job (Runs every hour)
cron.schedule('0 * * * *', async () => {
    console.log('Running 24h cleanup...');
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const { data: files } = await supabase.storage.from('videos').list();
    if (!files) return;

    const filesToDelete = files.filter(f => new Date(f.created_at) < oneDayAgo).map(f => f.name);
    if (filesToDelete.length > 0) await supabase.storage.from('videos').remove(filesToDelete);
});

// The API Documentation UI
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Movies Hub Pro - Automation API</title>
            <style>
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0d1117; color: #c9d1d9; max-width: 800px; margin: 40px auto; padding: 20px; line-height: 1.6; }
                h1 { color: #58a6ff; border-bottom: 1px solid #30363d; padding-bottom: 10px; }
                .endpoint { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
                .badge { background: #238636; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 14px; margin-right: 10px; }
                code { background: #21262d; padding: 2px 6px; border-radius: 4px; color: #ff7b72; font-family: monospace; }
            </style>
        </head>
        <body>
            <h1>🎬 Movies Hub Pro - Video Automation API</h1>
            <p>Welcome to your dedicated video processing engine. Send HTTP POST requests to the endpoints below using Postman or your preferred code environment. Maximum file size: 20MB.</p>
            
            <div class="endpoint">
                <h3><span class="badge">POST</span> /trim</h3>
                <p>Cuts a specific segment out of a video.</p>
                <ul>
                    <li><code>video</code>: The video file (form-data).</li>
                    <li><code>startTime</code>: Seconds to start cutting from (e.g., 0).</li>
                    <li><code>duration</code>: Length of the clip in seconds (e.g., 15 for a Short).</li>
                </ul>
            </div>

            <div class="endpoint">
                <h3><span class="badge">POST</span> /crop</h3>
                <p>Crops the video dimensions.</p>
                <ul>
                    <li><code>video</code>: The video file (form-data).</li>
                    <li><code>w</code>, <code>h</code>: Width and Height (e.g., 1080 and 1920 for vertical).</li>
                    <li><code>x</code>, <code>y</code>: Coordinates to start cropping from (default 0).</li>
                </ul>
            </div>

            <div class="endpoint">
                <h3><span class="badge">POST</span> /add-voice</h3>
                <p>Overlays a new audio track onto a video.</p>
                <ul>
                    <li><code>video</code>: The video file (form-data).</li>
                    <li><code>audio</code>: The audio file (mp3/wav) (form-data).</li>
                </ul>
            </div>

            <div class="endpoint">
                <h3><span class="badge">POST</span> /add-caption</h3>
                <p>Burns a subtitle file directly into the video.</p>
                <ul>
                    <li><code>video</code>: The video file (form-data).</li>
                    <li><code>subtitle</code>: The .srt subtitle file (form-data).</li>
                </ul>
            </div>

            <div class="endpoint">
                <h3><span class="badge">POST</span> /merge</h3>
                <p>Combines two videos together sequentially.</p>
                <ul>
                    <li><code>videos</code>: Upload exactly 2 video files under the same key name (form-data).</li>
                </ul>
            </div>
            
            <p style="text-align: center; color: #8b949e; font-size: 14px; margin-top: 40px;">System Status: Online | Auto-Deletion: 24 Hours</p>
        </body>
        </html>
    `);
});

app.listen(port, () => console.log(`API running on port ${port}`));
