import { useState } from "react";
import { MessageSquare } from "./anim-icons";
import { RiArrowRightLine } from "./ReIcons";

export type Friend = {
  id: string;
  name: string;
  avatar: string;
  status: string;
  game?: string;
};

const DEFAULT_FRIENDS: Friend[] = [
  {
    id: "f1",
    name: "ArkoPlayz",
    avatar: "/images/orbit/friend_arko_2x.png",
    status: "Playing Skyrealm",
    game: "skyrealm",
  },
  {
    id: "f2",
    name: "MayaGamer",
    avatar: "/images/orbit/friend_maya_2x.png",
    status: "In Lobby",
  },
  {
    id: "f3",
    name: "RitwikXD",
    avatar: "/images/orbit/friend_ritwik_2x.png",
    status: "Playing Drift Nexus",
    game: "drift-nexus",
  },
];

export default function FriendsOnlinePanel() {
  const [activeChat, setActiveChat] = useState<Friend | null>(null);

  return (
    <div className="dashboard-panel friends-online-panel" id="friends-panel">
      <div className="panel-header">
        <h2 className="panel-title">
          Friends Online <span className="online-count">• 12</span>
        </h2>
        <button
          type="button"
          className="panel-header-arrow"
          aria-label="View all friends"
          title="Open Friends List"
          onClick={() => alert("12 friends currently online across Orbit servers.")}
        >
          <RiArrowRightLine size={17} />
        </button>
      </div>

      <ul className="friends-list">
        {DEFAULT_FRIENDS.map((friend) => (
          <li key={friend.id} className="friend-row">
            <button
              type="button"
              className="friend-item-btn"
              onClick={() => setActiveChat(friend)}
            >
              <div className="friend-avatar-wrap">
                <img src={friend.avatar} alt={friend.name} className="friend-avatar" />
                <span className="friend-status-dot online" />
              </div>

              <div className="friend-info">
                <span className="friend-name">{friend.name}</span>
                <span className="friend-status-text">
                  <span className="status-bullet">●</span> {friend.status}
                </span>
              </div>

              <div className="friend-action-icon" aria-hidden="true">
                <MessageSquare size={14} />
              </div>
            </button>
          </li>
        ))}
      </ul>

      {/* Quick message popup if clicked */}
      {activeChat ? (
        <div className="friend-chat-toast">
          <span>Chat with {activeChat.name} opened in sidebar</span>
          <button type="button" onClick={() => setActiveChat(null)}>✕</button>
        </div>
      ) : null}
    </div>
  );
}

