const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 4001 });

let channels = {}; // { channelName: { username: ws } }

wss.on('connection', ws=>{
  let username, currentChannel;

  ws.on('message', msg=>{
    const data = JSON.parse(msg);

    if(data.type==='join-channel'){
      username = data.username;
      currentChannel = data.channel;

      if(!channels[currentChannel]) channels[currentChannel] = {};
      channels[currentChannel][username] = ws;

      // отправить текущих участников
      const members = Object.keys(channels[currentChannel]).filter(u=>u!==username);
      ws.send(JSON.stringify({ type:'channel-members', members }));

      // уведомить остальных о новом участнике
      Object.entries(channels[currentChannel]).forEach(([user,clientWs])=>{
        if(user!==username) clientWs.send(JSON.stringify({ type:'new-peer', peerId:username }));
      });
    }

    if(['offer','answer','ice-candidate'].includes(data.type)){
      const target = channels[currentChannel]?.[data.to];
      if(target) target.send(JSON.stringify(data));
    }

    if(data.type==='leave-channel'){
      if(currentChannel && channels[currentChannel]){
        delete channels[currentChannel][username];
        Object.values(channels[currentChannel]).forEach(client=>{
          client.send(JSON.stringify({ type:'leave', username }));
        });
      }
    }
  });

  ws.on('close', ()=>{
    if(currentChannel && channels[currentChannel] && username){
      delete channels[currentChannel][username];
      Object.values(channels[currentChannel]).forEach(client=>{
        client.send(JSON.stringify({ type:'leave', username }));
      });
    }
  });
});