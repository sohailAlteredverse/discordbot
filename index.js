const envVars = {
    "inworldKey": "",
    "inworldSecret": "",
    "inworldScene": "",
    "discordToken": "",

    "channel_id": ""
};

//Import modules
const unidecode = require('unidecode');
const audioconcat=require('wav-concat');
const fs = require("fs");
const { InworldClient, InworldPacket, ServiceError, SessionToken, status } = require("@inworld/nodejs-sdk");
const { Client, DMChannel, GatewayIntentBits, Message, Partials, TextChannel } = require("discord.js");

//Storage handlers
var storage = require("./storage.json");
function save() {
    fs.writeFileSync("./storage.json", JSON.stringify(storage));
}

//Other constant variables
const sessions = require("./sessions.json");

//Inworld AI stuff
var curAudio=[];
var curText=[];
var conns = {};//A variable that stores the current contexts, stands for "connections"
var lastChannels={};
function generateSessionToken(key) {
    return async () => {
        const inClient = new InworldClient().setApiKey({
            key: envVars.inworldKey,
            secret: envVars.inworldSecret
        });
        const token = await inClient.generateSessionToken();
        const sessionId = sessions[key];
        const actualToken = new SessionToken({
            expirationTime: token.expirationTime,
            token: token.token,
            type: token.type,
            sessionId: sessionId || token.sessionId
        });
        if (!sessionId) {
            sessions[key] = actualToken.sessionId;
            fs.writeFileSync("./sessions.json", JSON.stringify(sessions));
        }
        return actualToken;
    };
}
function createInWorldClient(args) {
    var inClient = new InworldClient()
        .setGenerateSessionToken(generateSessionToken(`${args.msg.channel.id}_${args.msg.author.id}`))
        .setConfiguration({
            capabilities: { audio: false },
            ...(args.dm ? {} : { connection: { disconnectTimeout: 60000 } })
        })
        .setUser({ fullName: unidecode(args.msg.author.username)==="ℭ𝔩𝔞𝔰𝔰𝔦𝔠 𝔑𝔬𝔞𝔥"?"The One we shall not name":unidecode(args.msg.author.username) })
        .setScene(envVars.inworldScene)
        .setOnError(handleError(args.msg))
        .setOnMessage((packet) => {
            if (packet.isText() && packet.text.final) {
                curText.push(packet.text.text.startsWith(" ")?packet.text.text.slice(1,packet.text.text.length):packet.text.text);
            }
            if(packet.isAudio()){
                curAudio.push(packet.audio.chunk);
            }
            if(packet.control){
                if(packet.control.type==="INTERACTION_END"){
                    if(curAudio.length===0){
                        args.msg.channel.send(curText.join("\n"));
                        inClient.close();
                        return;
                    }
                    var toMerge=[];
                    for(var i=0;i<curAudio.length;i++){
                        fs.writeFileSync('./audio'+i+'.wav', Buffer.from(curAudio[i],"base64"));
                        toMerge.push('audio'+i+".wav");
                    }
                    if(toMerge.length>1){
                        audioconcat(toMerge).concat("audio.wav")
                            .on('end',out=>{
                                args.msg.channel.send({content:curText.join("\n"),files:["./audio.wav"]});
                            });
                    }
                    else{
                        args.msg.channel.send({content:curText.join("\n"),files:["./audio0.wav"]});
                    }
                    inClient.close();
                }
            }
        })
        .build();
    return inClient;
}
async function sendMessage(msg, dm) {
    if (conns[msg.author.id] === null || conns[msg.author.id] === undefined || lastChannels[msg.author.id]!==msg.channel.id) {
        console.log("Made new connection for " + msg.author.tag);
        conns[msg.author.id] = await createInWorldClient({ dm: dm, msg: msg });
        lastChannels[msg.author.id]=msg.channel.id;
    }
    curText=[];
    curAudio=[];
    conns[msg.author.id].sendText(`Message from ${msg.author.username}: ${msg.content.replaceAll("<@" + client.user.id + ">", "")}`);
}
const handleError = (msg, dm) => {
    return (err) => {
        switch (err.code) {
            case status.ABORTED:
            case status.CANCELLED:
                break;
            case status.FAILED_PRECONDITION:
                sendMessage(msg, dm);
                break;
            default:
                console.error(err);
                break;
        }
    }
};

//Initialize Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageTyping,
        GatewayIntentBits.DirectMessageReactions
    ],
    partials: [Partials.Channel]
});
client.once('ready', () => {
    console.log("Logged into Discord as " + client.user.tag);
    try {

    }
    catch (e) { }
    setInterval(() => {
        try {
            fs.writeFileSync("./sessions.json", JSON.stringify({}));
        }
        catch (e) { }
    }, 1000 * 60 * 15);
});
client.on('messageCreate', async msg => {
    if (msg.author.bot) {
        return;
    }
    if (msg.mentions.has(client.user) && msg.content.startsWith("getPrefix")) {
        msg.reply("The prefix I currently respond to is `" + storage.prefix + "`");
        return;
    }
    if (msg.content.startsWith(storage.prefix)) {
        let cmd = msg.content.slice(storage.prefix.length, msg.content.length).toLowerCase();
        if (cmd.startsWith("toggle")&& storage.authorized.includes(msg.author.id)) {
            storage.needPing = !storage.needPing;
            msg.reply(storage.needPing ? "I will now only respond if you ping me" : "I will now respond to everything");
            save();
            return;
        }
        if (cmd.startsWith("changeprefix") && storage.authorized.includes(msg.author.id)) {
            if (msg.content.split(" ")[1]) {
                storage.prefix = msg.content.split(" ")[1];
                msg.reply("My new prefix is `" + storage.prefix + "`.");
                save();
            }
            else {
                msg.reply("No prefix specified");
            }
            return;
        }
        else if (cmd.startsWith("changeprefix")) {
            msg.reply("You don't have sufficient permission to do so. Ask someone authorized to run `" + storage.prefix + "authorize `<@" + msg.author.id + ">");
            return;
        }
        if (cmd.startsWith("authorize") && storage.authorized.includes(msg.author.id)) {
            if (!storage.authorized.includes(msg.mentions.users.first().id)) {
                storage.authorized.push(msg.mentions.users.first().id);
            }
            msg.reply("Authorized them");
            save();
            return;
        }
        else if (cmd.startsWith("authorize")) {
            msg.reply("You are not authorized to do this.");
            return;
        }
        if (cmd.startsWith("deauthorize") && storage.authorized.includes(msg.author.id)) {
            storage.authorized.splice(storage.authorized.indexOf(msg.mentions.users.first().id), 1);
            msg.reply("Deuthorized them");
            save();
            return;
        }
        else if (cmd.startsWith("deauthorize")) {
            msg.reply("You are not authorized to do this.");
            return;
        }
    }
    if (!storage.needPing) {
        sendMessage(msg);
    }
    else {
        if (msg.channel instanceof DMChannel) {
            console.log("DM!");
            sendMessage(msg, true);
        }
        else if (msg.mentions.has(client.user)) {
            console.log("Ping");
            if (/^<[@|#|@&].*?>$/g.test(msg.content.replace(/\s+/g, ''))) {//Regex to check if the message contains anything besides pings
                msg.content = "*User says nothing*";
            }
            sendMessage(msg);
        }
    }
});
client.login(envVars.discordToken);