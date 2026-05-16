with open("backend/database.py", "r") as f:
    content = f.read()

content = content.replace(
    "room_type = Column(String, default='private') # private, group, channel\n    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))",
    "room_type = Column(String, default='private') # private, group, channel\n    invite_code = Column(String, unique=True, nullable=True)\n    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))"
)

content = content.replace(
    "user_id = Column(Integer, ForeignKey('users.id'))\n    joined_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))",
    "user_id = Column(Integer, ForeignKey('users.id'))\n    role = Column(String, default='member')\n    joined_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))"
)

with open("backend/database.py", "w") as f:
    f.write(content)
