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
// SECRETS & SUPABASE INITIALIZATION
// ---------------------------------------------------------
// Pulls your Supabase keys from Render's Environment Variables
const supabaseUrl = process.env.SUPABASE_URL || 'https://ugjmpmsmuyrlkhqgvfwp.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const app = express();
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '100mb' }));

// ---------------------------------------------------------
// THE VIDEO STYLING ENGINE
// ---------------------------------------------------------
// High-converting dark-mode backgrounds and neon borders
const BACKGROUND_COLORS = ['#0f172a', '#1e1b4b', '#2e1065', '#27272a', '#052e16', '#171717'];
const BORDER_COLORS = ['#38bdf8', '#a78bfa', '#f472b6', '#fbbf24', '#34d399', '#f87171'];

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
            catch (err) { console.error(`Failed to delete ${file}`); }
        }
    });
}

// ---------------------------------------------------------
// ROUTES
// ---------------------------------------------------------
app.get('/', (req, res) => res.send('🚀 Supabase Viral Engine Online'));

app.post('/process-short', async (req, res) => {
    const { youtubeUrl, startTime, endTime, fullTranscript } = req.body;
    const jobId = uuidv4().substring(0, 8);

    if (!youtubeUrl || startTime === undefined || !fullTranscript || !supabaseKey) {
        return res.status(400).json({ error: 'Missing payload data or Supabase Key.' });
    }

    const srtFile = path.join(__dirname, `sub_${jobId}.srt`);
    const rawVideo = path.join(__dirname, `raw_${jobId}.mp4`);
    const finalVideo = path.join(__dirname, `final_${jobId}.mp4`);
    const finalFileName = `viral_short_${jobId}.mp4`;

    try {
        console.log(`\n[JOB ${jobId}] STARTED - URL: ${youtubeUrl}`);

        // 1. GENERATE SRT FILE
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

        // 2. DOWNLOAD CLIP
        console.log(`[JOB ${jobId}] Downloading segment...`);
        const downloadCmd = `yt-dlp -f "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/mp4" --download-sections "*${startTime}-${endTime}" "${youtubeUrl}" -o "${rawVideo}"`;
        
        exec(downloadCmd, { maxBuffer: 1024 * 1024 * 10 }, async (dlError) => {
            if (dlError) {
                cleanupFiles([srtFile, rawVideo]);
                return res.status(500).json({ error: 'Download failed.' });
            }

            // 3. THE MAGIC FFmpeg BUILDER
            const bgColor = BACKGROUND_COLORS[Math.floor(Math.random() * BACKGROUND_COLORS.length)];
            const borderColor = BORDER_COLORS[Math.floor(Math.random() * BORDER_COLORS.length)];
            
            // Look for a random BGM track in the local bgm/ folder
            let bgmCommand = '';
            let audioFilter = '-c:a copy'; // Default: just copy original audio
            const bgmDir = path.join(__dirname, 'bgm');
            
            if (fs.existsSync(bgmDir)) {
                const files = fs.readdirSync(bgmDir).filter(f => f.endsWith('.mp3'));
                if (files.length > 0) {
                    const randomBgm = path.join(bgmDir, files[Math.floor(Math.random() * files.length)]);
                    console.log(`[JOB ${jobId}] Applying BGM: ${randomBgm}`);
                    // Loop the music endlessly, lower its volume to 10%, keep podcast volume at 100%
                    bgmCommand = `-stream_loop -1 -i "${randomBgm}"`;
                    audioFilter = `-filter_complex "[0:a]volume=1.0[main];[1:a]volume=0.10[bgm];[main][bgm]amix=inputs=2:duration=first:dropout_transition=0" -c:a aac`;
                }
            }

            console.log(`[JOB ${jobId}] Composing Video (Colors: ${bgColor}, ${borderColor})...`);
            
            // The ultimate FFmpeg filter:
            // 1. Scale video width to 1000px
            // 2. Add a 10px colored border
            // 3. Pad the background to a perfect vertical 1080x1920 with a random color
            // 4. Burn in the subtitles with a custom yellow font & outline
            const videoFilter = `-vf "scale=1000:-1:force_original_aspect_ratio=decrease,pad=1020:ih+20:(ow-iw)/2:(oh-ih)/2:color='${borderColor}',pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color='${bgColor}',subtitles=${srtFile}:force_style='Fontname=Liberation Sans,FontSize=24,PrimaryColour=&H00FFFF,Outline=1,Shadow=2,MarginV=120'"`;

            const ffmpegCmd = `ffmpeg -i "${rawVideo}" ${bgmCommand} ${videoFilter} ${audioFilter} -c:v libx264 -preset fast -shortest "${finalVideo}"`;

            exec(ffmpegCmd, { maxBuffer: 1024 * 1024 * 10 }, async (ffError) => {
                if (ffError) {
                    cleanupFiles([srtFile, rawVideo, finalVideo]);
                    return res.status(500).json({ error: 'Video processing failed.' });
                }

                // 4. UPLOAD TO SUPABASE
                console.log(`[JOB ${jobId}] Uploading to Supabase...`);
                try {
                    const videoBuffer = fs.readFileSync(finalVideo);
                    const { data, error } = await supabase.storage
                        .from('shorts') // YOUR BUCKET NAME
                        .upload(finalFileName, videoBuffer, { contentType: 'video/mp4', upsert: true });

                    if (error) throw error;

                    // Get the public viewing URL
                    const { data: publicUrlData } = supabase.storage.from('shorts').getPublicUrl(finalFileName);
                    
                    console.log(`[JOB ${jobId}] Success! Video available at: ${publicUrlData.publicUrl}`);

                    // 5. THE ZERO-LOAD CLEANUP (Instantly delete from server)
                    cleanupFiles([srtFile, rawVideo, finalVideo]);

                    // Send the Supabase URL back to n8n!
                    res.status(200).json({ 
                        message: 'Video created and uploaded to Supabase successfully!',
                        videoUrl: publicUrlData.publicUrl,
                        jobId: jobId
                    });

                } catch (supaError) {
                    console.error(`[JOB ${jobId}] Supabase upload failed:`, supaError);
                    cleanupFiles([srtFile, rawVideo, finalVideo]);
                    res.status(500).json({ error: 'Failed to upload to Supabase.' });
                }
            });
        });

    } catch (error) {
        console.error(`[JOB ${jobId}] Fatal crash:`, error);
        cleanupFiles([srtFile, rawVideo, finalVideo]);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Supabase Viral Engine listening on port ${PORT}`));
