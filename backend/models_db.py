from sqlalchemy import Column, Integer, String, Float, DateTime, Text, Enum
from database import Base
from datetime import datetime, timedelta, timezone
import enum

def get_gmt7_time():
    return datetime.now(timezone(timedelta(hours=7))).replace(tzinfo=None)

class UserRole(str, enum.Enum):
    ADMIN = "admin"
    GUEST = "guest"

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    password_hash = Column(String)
    role = Column(String, default="guest") # Using string for simplicity in frontend mapping
    full_name = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    session_version = Column(Integer, default=1)

class OLTProfileDB(Base):
    __tablename__ = "olt_profiles"

    id = Column(Integer, primary_key=True, index=True)
    olt_type = Column(String, unique=True, index=True) # e.g., 'c600', 'c300'
    in_band_ip = Column(String, index=True)
    olt_name = Column(String, default="Registered OLT")
    hostname = Column(String)
    telnet_port = Column(Integer)
    enable_password = Column(String)
    username = Column(String)
    password = Column(String)
    snmp_community = Column(String, default="public")  # SNMP v2c community string
    snmp_port = Column(Integer, default=161)

class SystemSettings(Base):
    __tablename__ = "system_settings"

    key = Column(String, primary_key=True, index=True)
    value = Column(String)

class ONUCLILog(Base):
    __tablename__ = "onu_cli_logs"
    id = Column(Integer, primary_key=True, index=True)
    onu_index = Column(String, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    command = Column(Text)
    output = Column(Text)

class UnregisteredONU(Base):
    __tablename__ = "unregistered_onus"
    id = Column(Integer, primary_key=True, index=True)
    serial_number = Column(String, index=True)
    equipment_id = Column(String)
    software_version = Column(String)
    hw_version = Column(String, nullable=True)
    pon_index = Column(String) # e.g. "1/1/1"
    olt_ip = Column(String)
    last_seen = Column(DateTime, default=datetime.utcnow)

class UnconfiguredONU(Base):
    __tablename__ = "unconfigured_onus"
    id = Column(Integer, primary_key=True, index=True)
    serial_number = Column(String, index=True)
    name = Column(String)
    description = Column(String)
    status = Column(String) # "Configured" or "Unconfigured"
    equipment_id = Column(String)
    software_version = Column(String)
    pon_index = Column(String) # e.g. "1/1/1:1"
    olt_ip = Column(String)
    index_suffix = Column(String)
    hw_version = Column(String, nullable=True)
    last_seen = Column(DateTime, default=datetime.utcnow)
    
    # WAN & PPPoE fields added for C3xx Telnet status
    mode = Column(String, nullable=True)
    wan_username = Column(String, nullable=True)
    wan_password = Column(String, nullable=True)
    wan_ip = Column(String, nullable=True)
    wan_hostname = Column(String, nullable=True)
    wan_ip_index = Column(Integer, nullable=True)

class ConfiguredONU(Base):
    __tablename__ = "configured_onus"
    id = Column(Integer, primary_key=True, index=True)
    serial_number = Column(String, index=True)
    name = Column(String)
    description = Column(String)
    status = Column(String) # "Online" or "Unconfigured"
    pon_index = Column(String) # e.g. "1/1/1:1"
    olt_ip = Column(String)
    last_seen = Column(DateTime, default=datetime.utcnow)

class ONUPowerHistory(Base):
    __tablename__ = "onu_power_history"
    id = Column(Integer, primary_key=True, index=True)
    serial_number = Column(String, index=True)
    olt_ip = Column(String, index=True)
    rx_power = Column(Float)
    tx_power = Column(Float)
    temperature = Column(Float, nullable=True)
    timestamp = Column(DateTime, default=get_gmt7_time)

class VLANRecord(Base):
    __tablename__ = "vlan_records"
    id = Column(Integer, primary_key=True, index=True)
    vlan_id = Column(Integer, index=True)
    name = Column(String)
    description = Column(String)
    olt_ip = Column(String, index=True)
    last_updated = Column(DateTime, default=datetime.utcnow)
