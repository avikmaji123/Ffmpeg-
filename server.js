const express = require('express');
const fs = require('fs');
const { exec } = require('child_process');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ---------------------------------------------------------
// SECRETS & SETUP
// ---------------------------------------------------------
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '100mb' }));

// ---------------------------------------------------------
// UTILS
// ---------------------------------------------------------
const BACKGROUND_COLORS = ['#0f172a', '#1e1b4b', '#2e1065', '#27272a', '#052e16', '#171717'];
const BORDER_COLORS = ['#38bdf8', '#a78bfa', '#f472b6', '#fbbf24', '#34d399', '#f87171'];
const processQueue = new Map(); // Simple in-memory queue to track jobs

function formatSrtTime(seconds) {
    const date = new Date(Math.max(0, seconds) * 1000);
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const mm = String(date.getUTCMinutes()).padStart(2, '0');
    const ss = String(date.getUTCSeconds()).padStart(2, '0');
    const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss},${ms}`;
}

function cleanupFiles(files) {
    files.forEach(file => {
        if (fs.existsSync(file)) {
            try { fs.unlinkSync(file); } 
            catch (err) { console.error(`[CLEANUP ERROR] Failed to delete ${file}`); }
        }
    });
}

// ---------------------------------------------------------
// DASHBOARD & STATUS ROUTE
// ---------------------------------------------------------
app.get('/', (req, res) => {
    const isSupabaseConnected = supabase !== null;
    const hasCookies = fs.existsSync(path.join(__dirname, 'cookies.txt'));
    
    // Render the Dashboard UI...
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Viral Engine V6 Dashboard</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background-color: #0d1117; color: #c9d1d9; padding: 40px; }
            .container { max-width: 800px; margin: auto; background-color: #161b22; padding: 30px; border-radius: 12px; border: 1px solid #30363d; }
            h1 { color: #58a6ff; }
            .badge { padding: 5px 12px; border-radius: 20px; font-weight: bold; font-size: 14px; display: inline-block; margin-bottom: 5px; }
            .ok { background-color: rgba(35, 134, 54, 0.2); color: #3fb950; border: 1px solid #238636; }
            .warn { background-color: rgba(210, 153, 34, 0.2); color: #d29922; border: 1px solid #9e6a03; }
            .card { background-color: #0d1117; border: 1px solid #30363d; border-radius: 8px; padding: 20px; margin-top: 20px; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🚀 Viral Engine V6 (Async Queued)</h1>
            <div class="card">
                <h3>Status</h3>
                <p>Core: <span class="badge ok">Online</span></p>
                <p>Supabase: ${isSupabaseConnected ? '<span class="badge ok">Configured</span>' : '<span class="badge warn">Missing Keys</span>'}</p>
                <p>Anti-Bot: ${hasCookies ? '<span class="badge ok">Active (cookies.txt)</span>' : '<span class="badge warn">Inactive (Android Spoof)</span>'}</p>
            </div>
            <div class="card">
                <h3>Check Job Status</h3>
                <p>Use <code>GET /status/:jobId</code> to see progress.</p>
            </div>
        </div>
    </body>
    </html>
    `;
    res.send(html);
});

// Endpoint to check job status (crucial for n8n or client apps)
app.get('/status/:jobId', (req, res) => {
    const job = processQueue.get(req.params.jobId);
    if (!job) {
        return res.status(404).json({ error: 'Job ID not found or expired.' });
    }
    res.json(job);
});

// ---------------------------------------------------------
// ASYNC PROCESS ROUTE
// ---------------------------------------------------------
app.post('/process-short', async (req, res) => {
    const { youtubeUrl, startTime, endTime, fullTranscript } = req.body;
    const jobId = uuidv4().substring(0, 8);

    if (!youtubeUrl || startTime === undefined || !fullTranscript || !supabase) {
        return res.status(400).json({ error: 'Missing payload or Supabase setup.' });
    }

    // Instantly respond to prevent Cloudflare Timeout
    res.status(202).json({
        message: 'Job accepted. Processing in background.',
        jobId: jobId,
        statusUrl: `https://${req.get('host')}/status/${jobId}`
    });

    // Start background work
    processQueue.set(jobId, { status: 'Processing started', url: null });
    
    // File Paths
    const srtFile = path.join(__dirname, `sub_${jobId}.srt`);
    const rawVideo = path.join(__dirname, `raw_${jobId}.mp4`);
    const finalVideo = path.join(__dirname, `final_${jobId}.mp4`);
    const finalFileName = `viral_short_${jobId}.mp4`;

    try {
        console.log(`\n[JOB ${jobId}] Started Async...`);

        // 1. Generate SRT
        let srtContent = '';
        let subtitleIndex = 1;
        fullTranscript.forEach(line => {
            if (line.start >= startTime && line.end <= endTime) {
                const startMath = line.start - startTime;
                const endMath = line.end - startTime;
                srtContent += `${subtitleIndex}\n${formatSrtTime(startMath)} --> ${formatSrtTime(endMath)}\n${line.text}\n\n`;
                subtitleIndex++;
            }
        });
        fs.writeFileSync(srtFile, srtContent);

        // 2. Download Clip
        const cookiesPath = path.join(__dirname, 'cookies.txt');
        const cookieArg = fs.existsSync(cookiesPath) ? `--cookies "${cookiesPath}"` : '';
        const downloadCmd = `yt-dlp --rm-cache-dir ${cookieArg} --js-runtimes node --extractor-args "youtube:player_client=android,web" -f "bestvideo[height<=1080]+bestaudio/best" --download-sections "*${startTime}-${endTime}" "${youtubeUrl}" -o "${rawVideo}"`;
        
        exec(downloadCmd, { maxBuffer: 1024 * 1024 * 10 }, async (dlError, stdout, stderr) => {
            if (dlError) {
                console.error(`[JOB ${jobId}] Download Error:`, stderr);
                processQueue.set(jobId, { status: 'Failed: Download Error', error: stderr });
                return cleanupFiles([srtFile, rawVideo]);
            }

            // 3. Render Final Video (Optimized)
            const bgColor = BACKGROUND_COLORS[Math.floor(Math.random() * BACKGROUND_COLORS.length)];
            const borderColor = BORDER_COLORS[Math.floor(Math.random() * BORDER_COLORS.length)];
            
            let bgmCommand = '';
            let audioFilter = '-c:a copy'; 
            const bgmDir = path.join(__dirname, 'bgm');
            
            if (fs.existsSync(bgmDir)) {
                const files = fs.readdirSync(bgmDir).filter(f => f.endsWith('.mp3'));
                if (files.length > 0) {
                    const randomBgm = path.join(bgmDir, files[Math.floor(Math.random() * files.length)]);
                    bgmCommand = `-stream_loop -1 -i "${randomBgm}"`;
                    audioFilter = `-filter_complex "[0:a]volume=1.0[main];[1:a]volume=0.10[bgm];[main][bgm]amix=inputs=2:duration=first:dropout_transition=0" -c:a aac`;
                }
            }

            // Highly optimized command to render quickly (preset veryfast, lower thread count)
            const videoFilter = `-vf "scale=1000:-1:force_original_aspect_ratio=decrease,pad=1020:ih+20:(ow-iw)/2:(oh-ih)/2:color='${borderColor}',pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color='${bgColor}',subtitles=${srtFile}:force_style='Fontname=Liberation Sans,FontSize=24,PrimaryColour=&H00FFFF,Outline=1,Shadow=2,MarginV=120'"`;
            const ffmpegCmd = `ffmpeg -y -i "${rawVideo}" ${bgmCommand} ${videoFilter} ${audioFilter} -c:v libx264 -preset veryfast -crf 28 -threads 2 -shortest "${finalVideo}"`;

            exec(ffmpegCmd, { maxBuffer: 1024 * 1024 * 10 }, async (ffError, ffStdout, ffStderr) => {
                if (ffError) {
                    console.error(`[JOB ${jobId}] Render Error:`, ffStderr);
                    processQueue.set(jobId, { status: 'Failed: Render Error', error: ffStderr });
                    return cleanupFiles([srtFile, rawVideo, finalVideo]);
                }

                // 4. Supabase Upload
                try {
                    const videoBuffer = fs.readFileSync(finalVideo);
                    const { data, error } = await supabase.storage.from('shorts').upload(finalFileName, videoBuffer, { contentType: 'video/mp4', upsert: true });

                    if (error) throw error;

                    const { data: publicUrlData } = supabase.storage.from('shorts').getPublicUrl(finalFileName);
                    console.log(`[JOB ${jobId}] Finished: ${publicUrlData.publicUrl}`);

                    // Update Queue with Final URL
                    processQueue.set(jobId, { status: 'Completed', url: publicUrlData.publicUrl });
                    cleanupFiles([srtFile, rawVideo, finalVideo]);

                    // Free memory tracking after 1 hour
                    setTimeout(() => processQueue.delete(jobId), 3600000);

                } catch (supaError) {
                    console.error(`[JOB ${jobId}] Supabase Error:`, supaError);
                    processQueue.set(jobId, { status: 'Failed: Upload Error', error: supaError.message });
                    cleanupFiles([srtFile, rawVideo, finalVideo]);
                }
            });
        });

    } catch (error) {
        console.error(`[JOB ${jobId}] Fatal Error:`, error);
        processQueue.set(jobId, { status: 'Failed: Internal Error' });
        cleanupFiles([srtFile, rawVideo, finalVideo]);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Viral Engine V6 Online on port ${PORT}`));
                                             
