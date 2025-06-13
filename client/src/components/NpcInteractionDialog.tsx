'''import React, { useState, useEffect, useRef } from 'react';
import { NpcData, PlayerNpcInteraction } from '../generated'; // Adjust path as necessary

interface NpcInteractionDialogProps {
  npc: NpcData;
  conversation: PlayerNpcInteraction[];
  onSendMessage: (npcId: number, message: string) => void;
  onClose: () => void;
  localPlayerIdentityHex: string | null; // To identify player messages for styling
}

export const NpcInteractionDialog: React.FC<NpcInteractionDialogProps> = ({
  npc,
  conversation,
  onSendMessage,
  onClose,
  localPlayerIdentityHex,
}) => {
  const [playerMessage, setPlayerMessage] = useState('');
  const messagesEndRef = useRef<null | HTMLDivElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (playerMessage.trim()) {
      onSendMessage(npc.npc_id, playerMessage.trim());
      setPlayerMessage('');
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation]);

  // Sort conversation by timestamp
  const sortedConversation = [...conversation].sort((a, b) => 
    (a.timestamp || 0) > (b.timestamp || 0) ? 1 : -1
  );

  return (
    <div style={{
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: '400px',
      maxHeight: '80vh',
      backgroundColor: 'rgba(50, 50, 70, 0.9)',
      border: '1px solid #668',
      borderRadius: '8px',
      padding: '20px',
      boxShadow: '0 0 15px rgba(0,0,0,0.5)',
      zIndex: 1000,
      color: 'white',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
        <h3 style={{ margin: 0 }}>{npc.name}</h3>
        <button 
            onClick={onClose} 
            style={{ 
                background: 'rgba(200, 50, 50, 0.8)', 
                color: 'white', border: 'none', 
                padding: '5px 10px', 
                borderRadius: '4px', 
                cursor: 'pointer' 
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(220, 70, 70, 1)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(200, 50, 50, 0.8)')}
        >
            Close
        </button>
      </div>

      <div style={{ flexGrow: 1, overflowY: 'auto', marginBottom: '15px', paddingRight: '10px' }}>
        {/* Display NPC Greeting if no conversation or as first message */}
        {sortedConversation.length === 0 && npc.dialogue_greeting && (
             <div style={{ marginBottom: '10px', fontStyle: 'italic', color: '#aaa' }}>
                <strong>{npc.name}: </strong>{npc.dialogue_greeting}
            </div>
        )}
        {sortedConversation.map((entry) => {
          const isPlayer = entry.speaker === 'player';
          const messageOwnerIdentityHex = typeof entry.player_identity === 'string' 
            ? entry.player_identity // If it's already a hex string
            : entry.player_identity?.toHexString(); // If it's an Identity object

          const isLocalPlayerMessage = isPlayer && messageOwnerIdentityHex === localPlayerIdentityHex;
          
          return (
            <div 
              key={entry.interaction_id.toString()} 
              style={{ 
                marginBottom: '8px', 
                textAlign: isLocalPlayerMessage ? 'right' : 'left',
              }}
            >
              <div style={{
                display: 'inline-block',
                padding: '8px 12px',
                borderRadius: '10px',
                backgroundColor: isLocalPlayerMessage ? 'rgba(80, 120, 200, 0.7)' : 'rgba(70, 70, 90, 0.7)',
                maxWidth: '80%',
                wordWrap: 'break-word',
              }}>
                <strong>{isPlayer ? (isLocalPlayerMessage ? "You" : `Player ${messageOwnerIdentityHex?.substring(0,4) || '??'}`) : npc.name}: </strong>
                {entry.message}
                <div style={{ fontSize: '0.7em', color: '#ccc', marginTop: '3px', textAlign: 'right' }}>
                  {new Date(Number(entry.timestamp) * 1000).toLocaleTimeString()}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex' }}>
        <input
          type="text"
          value={playerMessage}
          onChange={(e) => setPlayerMessage(e.target.value)}
          placeholder="Say something..."
          style={{ 
            flexGrow: 1, 
            padding: '10px', 
            borderRadius: '4px 0 0 4px', 
            border: '1px solid #557', 
            backgroundColor: '#334', 
            color: 'white' 
          }}
        />
        <button 
            type="submit" 
            style={{ 
                padding: '10px 15px', 
                borderRadius: '0 4px 4px 0', 
                border: 'none', 
                backgroundColor: 'rgba(80, 120, 200, 0.8)', 
                color: 'white', 
                cursor: 'pointer' 
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(100, 140, 220, 1)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(80, 120, 200, 0.8)')}
        >
            Send
        </button>
      </form>
    </div>
  );
};
''