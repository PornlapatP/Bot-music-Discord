const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, AudioPlayerInputType } = require('@discordjs/voice');
const { exec } = require('child_process');  // ใช้ child_process เพื่อเรียกใช้ yt-dlp
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.MessageContent] });
const prefix = process.env.PREFIX || '!';
const queue = new Map();

// เมื่อบอทพร้อม
client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

// ฟังก์ชันเล่นเพลง
async function playSong(guild, song) {
    const serverQueue = queue.get(guild.id);
    if (!song) {
        if (serverQueue) {
            serverQueue.connection.destroy();
            queue.delete(guild.id);
        }
        return;
    }

    try {
        const tempAudioFile = path.join(__dirname, 'temp_audio.mp3');  // ใช้ชื่อไฟล์ชั่วคราว

        // ใช้ yt-dlp เพื่อดึงเสียงจาก YouTube
        exec(`yt-dlp -f bestaudio -o "${tempAudioFile}" ${song.url}`, (err, stdout, stderr) => {
            if (err) {
                console.error('Error executing yt-dlp:', err);
                if (serverQueue && serverQueue.connection) {
                    serverQueue.connection.destroy();
                }
                queue.delete(guild.id);
                guild.systemChannel?.send('เกิดข้อผิดพลาดในการเล่นเพลง!');
                return;
            }

            // ตรวจสอบว่า `stdout` ได้ข้อมูลเพลง
            if (stderr) {
                console.error('stderr:', stderr);
            }

            const resource = createAudioResource(fs.createReadStream(tempAudioFile), { inputType: AudioPlayerInputType.Arbitrary });
            const player = createAudioPlayer();
            
            player.on(AudioPlayerStatus.Idle, () => {
                serverQueue.songs.shift();
                playSong(guild, serverQueue.songs[0]);
            });

            player.on('error', (error) => {
                console.error("Error playing audio:", error);
                if (serverQueue && serverQueue.connection) {
                    serverQueue.connection.destroy();
                }
                queue.delete(guild.id);
            });

            if (serverQueue && serverQueue.connection) {
                serverQueue.connection.subscribe(player);
            }

            player.play(resource);
            serverQueue.player = player;

            guild.systemChannel?.send(`🎵 กำลังเล่น: **${song.title}**`);
        });

    } catch (err) {
        console.error(err);
        if (serverQueue && serverQueue.connection) {
            serverQueue.connection.destroy();
        }
        queue.delete(guild.id);
        guild.systemChannel?.send('เกิดข้อผิดพลาดในการเล่นเพลง!');
    }
}

// เมื่อมีข้อความ
client.on('messageCreate', async (message) => {
    if (!message.content.startsWith(prefix) || message.author.bot) return;

    const args = message.content.slice(prefix.length).trim().split(' ');
    const command = args.shift().toLowerCase();
    const voiceChannel = message.member.voice.channel;

    if (command === 'play') {
        if (!voiceChannel) return message.reply('คุณต้องอยู่ในห้องเสียงก่อน!');

        const serverQueue = queue.get(message.guild.id);

        try {
            // ดึงข้อมูลเพลงจาก URL โดยใช้ yt-dlp
            exec(`yt-dlp -j ${args[0]}`, (err, stdout, stderr) => {
                if (err) {
                    console.error(err);
                    return message.reply('ไม่สามารถดึงข้อมูลเพลงได้!');
                }

                const songInfo = JSON.parse(stdout);
                const song = { title: songInfo.title, url: songInfo.webpage_url };

                if (!serverQueue) {
                    const queueContruct = { voiceChannel, connection: null, songs: [] };
                    queue.set(message.guild.id, queueContruct);
                    queueContruct.songs.push(song);

                    const connection = joinVoiceChannel({
                        channelId: voiceChannel.id,
                        guildId: message.guild.id,
                        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                    });
                    queueContruct.connection = connection;
                    playSong(message.guild, queueContruct.songs[0]);
                } else {
                    serverQueue.songs.push(song);
                    return message.reply(`🎶 เพิ่มเพลง ${song.title} ในคิว!`);
                }
            });
        } catch (err) {
            console.error(err);
            return message.reply('ไม่สามารถเล่นเพลงจาก YouTube ได้!');
        }
    }

    if (command === 'skip') {
        const serverQueue = queue.get(message.guild.id);
        if (!serverQueue) return message.reply('ไม่มีเพลงให้ข้าม!');
        serverQueue.player.stop();
        return message.reply('⏭️ ข้ามเพลง!');
    }

    if (command === 'stop') {
        const serverQueue = queue.get(message.guild.id);
        if (!serverQueue) return message.reply('ไม่มีเพลงที่กำลังเล่น!');
        serverQueue.songs = [];
        if (serverQueue.connection) {
            serverQueue.connection.destroy();
        }
        queue.delete(message.guild.id);
        return message.reply('🛑 หยุดเพลงและออกจากห้องเสียง!');
    }

    if (command === 'volume') {
        const volume = parseFloat(args[0]);
        if (isNaN(volume) || volume < 0 || volume > 1) return message.reply('ระบุระดับเสียงระหว่าง 0.0 ถึง 1.0!');
        const serverQueue = queue.get(message.guild.id);
        if (serverQueue) {
            serverQueue.player.setVolume(volume);
            return message.reply(`🔊 ตั้งเสียงเป็น ${volume * 100}%`);
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
