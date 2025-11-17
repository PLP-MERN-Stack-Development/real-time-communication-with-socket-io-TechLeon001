const React = require('react');
const { useState, useEffect, useRef } = React;
const io = require('socket.io-client');
const axios = require('axios');

const SOCKET_URL = 'http://localhost:5000';

function App() {
  const [socket, setSocket] = useState(null);
  const [user, setUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [currentRoom, setCurrentRoom] = useState('general');
  const [message, setMessage] = useState('');
  const [typingUsers, setTypingUsers] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [privateMessageTarget, setPrivateMessageTarget] = useState('');
  const [privateMessage, setPrivateMessage] = useState('');
  const [error, setError] = useState('');

  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (isAuthenticated && user) {
      const newSocket = io(SOCKET_URL, {
        auth: {
          token: localStorage.getItem('token')
        },
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000
      });

      newSocket.on('connect', () => {
        console.log('Connected to server');
        setError('');
      });

      newSocket.on('connect_error', (err) => {
        console.error('Connection error:', err);
        setError('Failed to connect to server');
      });

      newSocket.on('initial_data', (data) => {
        setRooms(data.rooms);
        setUsers(data.users);
        setMessages(data.messages);
      });

      newSocket.on('receive_message', (newMessage) => {
        setMessages(prev => [...prev, newMessage]);
        playNotificationSound();
      });

      newSocket.on('room_messages', (data) => {
        setMessages(data.messages);
        setCurrentRoom(data.room);
      });

      newSocket.on('user_joined', (data) => {
        setUsers(data.users);
        addNotification(`${data.username} joined the chat`);
      });

      newSocket.on('user_left', (data) => {
        setUsers(data.users);
        addNotification(`${data.username} left the chat`);
      });

      newSocket.on('user_joined_room', (data) => {
        addNotification(`${data.username} joined #${data.room}`);
      });

      newSocket.on('user_typing', (data) => {
        if (data.room === currentRoom) {
          setTypingUsers(prev => [...prev.filter(u => u !== data.username), data.username]);
        }
      });

      newSocket.on('user_stop_typing', (data) => {
        if (data.room === currentRoom) {
          setTypingUsers(prev => prev.filter(u => u !== data.username));
        }
      });

      newSocket.on('notification', (notification) => {
        addNotification(`${notification.username} sent a message in #${notification.room}`);
        showBrowserNotification(notification);
      });

      newSocket.on('message_reacted', (data) => {
        setMessages(prev => prev.map(msg => 
          msg.id === data.messageId ? { ...msg, reactions: data.reactions } : msg
        ));
      });

      newSocket.on('receive_private_message', (privateMsg) => {
        addNotification(`Private message from ${privateMsg.from}`);
        playNotificationSound();
        
        if (privateMsg.isOwn) {
          // This is our own message, we can handle it differently if needed
          console.log('Private message sent successfully');
        }
      });

      newSocket.on('error', (errorData) => {
        setError(errorData.message);
        addNotification(`Error: ${errorData.message}`);
      });

      newSocket.on('reconnect_success', (data) => {
        setUsers(data.users);
        setRooms(data.rooms);
        setMessages(data.messages);
        setCurrentRoom(data.currentRoom);
        addNotification('Reconnected to server');
      });

      setSocket(newSocket);

      return () => {
        newSocket.close();
      };
    }
  }, [isAuthenticated, user, currentRoom]);

  const playNotificationSound = () => {
    // Simple beep sound using Web Audio API
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 800;
      gainNode.gain.value = 0.1;
      
      oscillator.start();
      setTimeout(() => oscillator.stop(), 100);
    } catch (error) {
      console.log('Audio notification not supported');
    }
  };

  const showBrowserNotification = (notification) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('New Message', {
        body: `${notification.username}: ${notification.message}`,
        icon: '/favicon.ico'
      });
    }
  };

  const requestNotificationPermission = () => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  };

  const addNotification = (text) => {
    const newNotification = { 
      id: Date.now(), 
      text, 
      timestamp: new Date(),
      type: 'info'
    };
    setNotifications(prev => [newNotification, ...prev.slice(0, 4)]);
    
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== newNotification.id));
    }, 5000);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const response = await axios.post(`${SOCKET_URL}/api/login`, loginForm);
      const { token, user } = response.data;
      
      localStorage.setItem('token', token);
      setUser(user);
      setIsAuthenticated(true);
      requestNotificationPermission();
      addNotification(`Welcome, ${user.username}!`);
    } catch (error) {
      const errorMessage = error.response?.data?.error || 'Login failed';
      setError(errorMessage);
      addNotification(`Login failed: ${errorMessage}`);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const response = await axios.post(`${SOCKET_URL}/api/register`, loginForm);
      const { token, user } = response.data;
      
      localStorage.setItem('token', token);
      setUser(user);
      setIsAuthenticated(true);
      requestNotificationPermission();
      addNotification(`Account created! Welcome, ${user.username}!`);
    } catch (error) {
      const errorMessage = error.response?.data?.error || 'Registration failed';
      setError(errorMessage);
      addNotification(`Registration failed: ${errorMessage}`);
    }
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (message.trim() && socket) {
      socket.emit('send_message', {
        text: message,
        room: currentRoom
      });
      setMessage('');
    }
  };

  const handleTyping = () => {
    if (socket) {
      socket.emit('typing_start', currentRoom);
      clearTimeout(window.typingTimer);
      window.typingTimer = setTimeout(() => {
        socket.emit('typing_stop', currentRoom);
      }, 1000);
    }
  };

  const joinRoom = (roomName) => {
    if (socket && roomName !== currentRoom) {
      socket.emit('join_room', roomName);
    }
  };

  const reactToMessage = (messageId, reaction) => {
    if (socket) {
      socket.emit('react_to_message', {
        messageId,
        reaction,
        room: currentRoom
      });
    }
  };

  const sendPrivateMessage = (e) => {
    e.preventDefault();
    if (privateMessage.trim() && privateMessageTarget.trim() && socket) {
      socket.emit('send_private_message', {
        targetUsername: privateMessageTarget,
        text: privateMessage
      });
      setPrivateMessage('');
      setPrivateMessageTarget('');
    }
  };

  const handleLogout = () => {
    if (socket) {
      socket.close();
    }
    localStorage.removeItem('token');
    setUser(null);
    setIsAuthenticated(false);
    setMessages([]);
    setUsers([]);
    setError('');
  };

  if (!isAuthenticated) {
    return (
      <div className="auth-container">
        <div className="auth-form">
          <h1>💬 Chat Application</h1>
          <p className="auth-subtitle">Real-time messaging with Socket.io</p>
          
          {error && <div className="error-message">{error}</div>}
          
          <form onSubmit={handleLogin}>
            <input
              type="text"
              placeholder="Username"
              value={loginForm.username}
              onChange={(e) => setLoginForm(prev => ({ ...prev, username: e.target.value }))}
              required
            />
            <input
              type="password"
              placeholder="Password"
              value={loginForm.password}
              onChange={(e) => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
              required
            />
            <div className="auth-buttons">
              <button type="submit">Login</button>
              <button type="button" onClick={handleRegister}>Register</button>
            </div>
          </form>
          
          <div className="demo-credentials">
            <p><strong>Demo:</strong> Use any username with password "password"</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {/* Notifications */}
      <div className="notifications">
        {notifications.map(notification => (
          <div key={notification.id} className={`notification ${notification.type}`}>
            {notification.text}
          </div>
        ))}
      </div>

      {/* Error Display */}
      {error && <div className="error-banner">{error}</div>}

      <div className="chat-container">
        {/* Sidebar */}
        <div className="sidebar">
          <div className="user-info">
            <h3>👋 Welcome, {user?.username}!</h3>
            <button onClick={handleLogout} className="logout-btn">Logout</button>
          </div>

          <div className="rooms-section">
            <h4>🗨️ Rooms</h4>
            {rooms.map(room => (
              <div
                key={room}
                className={`room-item ${currentRoom === room ? 'active' : ''}`}
                onClick={() => joinRoom(room)}
              >
                # {room}
                {room === 'general' && ' 🌐'}
                {room === 'tech' && ' 💻'}
                {room === 'gaming' && ' 🎮'}
                {room === 'random' && ' 🎲'}
              </div>
            ))}
          </div>

          <div className="users-section">
            <h4>🟢 Online Users ({users.length})</h4>
            <div className="users-list">
              {users.map(user => (
                <div key={user.id} className="user-item">
                  <span className="status-dot online"></span>
                  {user.username}
                  {user.username !== user.username && (
                    <button
                      className="pm-btn"
                      onClick={() => setPrivateMessageTarget(user.username)}
                      title={`Message ${user.username}`}
                    >
                      💬
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Private Message Modal */}
          {privateMessageTarget && (
            <div className="pm-modal">
              <div className="pm-header">
                <h4>💌 Message to {privateMessageTarget}</h4>
                <button onClick={() => setPrivateMessageTarget('')}>×</button>
              </div>
              <form onSubmit={sendPrivateMessage} className="pm-form">
                <input
                  type="text"
                  value={privateMessage}
                  onChange={(e) => setPrivateMessage(e.target.value)}
                  placeholder="Type your private message..."
                  autoFocus
                />
                <div className="pm-buttons">
                  <button type="submit">Send</button>
                  <button type="button" onClick={() => setPrivateMessageTarget('')}>Cancel</button>
                </div>
              </form>
            </div>
          )}
        </div>

        {/* Main Chat Area */}
        <div className="main-chat">
          <div className="chat-header">
            <h2># {currentRoom}</h2>
            <div className="chat-info">
              <span className="user-count">{users.length} users online</span>
              <div className="typing-indicator">
                {typingUsers.length > 0 && (
                  <span>{typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...</span>
                )}
              </div>
            </div>
          </div>

          <div className="messages-container">
            {messages.length === 0 ? (
              <div className="no-messages">
                <p>No messages yet. Start the conversation! 💬</p>
              </div>
            ) : (
              messages.map(message => (
                <div key={message.id} className={`message ${message.type}`}>
                  <div className="message-header">
                    <strong className="username">{message.username}</strong>
                    <span className="timestamp">
                      {new Date(message.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="message-content">
                    {message.text}
                  </div>
                  {message.reactions && Object.keys(message.reactions).length > 0 && (
                    <div className="message-reactions">
                      {Object.entries(message.reactions).map(([reaction, users]) => (
                        <span
                          key={reaction}
                          className="reaction"
                          onClick={() => reactToMessage(message.id, reaction)}
                          title={users.join(', ')}
                        >
                          {reaction} {users.length}
                        </span>
                      ))}
                    </div>
                  )}
                  {message.type === 'text' && (
                    <div className="reaction-options">
                      {['👍', '❤️', '😂', '😮', '😢', '😡'].map(reaction => (
                        <button
                          key={reaction}
                          className="reaction-btn"
                          onClick={() => reactToMessage(message.id, reaction)}
                          title={`React with ${reaction}`}
                        >
                          {reaction}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          <form onSubmit={sendMessage} className="message-input">
            <input
              type="text"
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                handleTyping();
              }}
              placeholder={`Message #${currentRoom}...`}
              maxLength={500}
            />
            <button 
              type="submit" 
              disabled={!message.trim()}
              className={!message.trim() ? 'disabled' : ''}
            >
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// Export for React
module.exports = App;