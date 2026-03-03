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
const processQueue = new Map();

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
    
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Viral Engine V8 Dashboard</title>
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
            <h1>🚀 Viral Engine V8 (iOS/TV Spoofing)</h1>
            <div class="card">
                <h3>Status</h3>
                <p>Core: <span class="badge ok">Online</span></p>
                <p>Supabase: ${isSupabaseConnected ? '<span class="badge ok">Configured</span>' : '<span class="badge warn">Missing Keys</span>'}</p>
                <p>Bypass Mode: ${hasCookies ? '<span class="badge ok">Cookies Active (Must be Desktop!)</span>' : '<span class="badge warn">iPhone & Smart TV Spoofing (Active)</span>'}</p>
            </div>
        </div>
    </body>
    </html>
    `;
    res.send(html);
});

app.get('/status/:jobId', (req, res) => {
    const job = processQueue.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job ID not found or expired.' });
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

    res.status(202).json({
        message: 'Job accepted. Processing in background.',
        jobId: jobId,
        statusUrl: `https://${req.get('host')}/status/${jobId}`
    });

    processQueue.set(jobId, { status: 'Processing started', url: null });
    
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

        // 2. SMART DOWNLOAD ENGINE (V8 Upgrades)
        const cookiesPath = path.join(__dirname, 'cookies.txt');
        const hasCookies = fs.existsSync(cookiesPath);
        
        let downloadCmd = '';
        
        if (hasCookies) {
            console.log(`[JOB ${jobId}] Using Cookie Authentication Mode...`);
            // Standard cookie run, but widened format acceptance so it doesn't fail if specific MP4s are missing
            downloadCmd = `yt-dlp --cookies "${cookiesPath}" -f "bestvideo[height<=1080]+bestaudio/best" --download-sections "*${startTime}-${endTime}" "${youtubeUrl}" -o "${rawVideo}"`;
        } else {
            console.log(`[JOB ${jobId}] Using iOS & Smart TV Spoofing Mode...`);
            // V8 UPGRADE: Uses 'ios,tv' clients which currently bypass the 'n challenge' block best without cookies
            downloadCmd = `yt-dlp --js-runtimes node --extractor-args "youtube:player_client=ios,tv,web" -f "bestvideo[height<=1080]+bestaudio/best" --download-sections "*${startTime}-${endTime}" "${youtubeUrl}" -o "${rawVideo}"`;
        }
        
        exec(downloadCmd, { maxBuffer: 1024 * 1024 * 10 }, async (dlError, stdout, stderr) => {
            if (dlError) {
                console.error(`[JOB ${jobId}] Download Error:`, stderr);
                processQueue.set(jobId, { status: 'Failed: Download Error (Bot Blocked)', error: stderr });
                return cleanupFiles([srtFile, rawVideo]);
            }

            console.log(`[JOB ${jobId}] Download successful. Starting render...`);

            // 3. Render Final Video
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

                    processQueue.set(jobId, { status: 'Completed', url: publicUrlData.publicUrl });
                    cleanupFiles([srtFile, rawVideo, finalVideo]);

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
app.listen(PORT, () => console.log(`🚀 Viral Engine V8 Online on port ${PORT}`));
