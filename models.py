from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, ForeignKey, Float, LargeBinary
from sqlalchemy.orm import relationship, backref
from datetime import datetime
from database import Base


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    hashed_password = Column(String(128), nullable=False)
    role = Column(String(20), nullable=False)  # super_admin, admin, province_manager, region_manager, business_manager, user
    real_name = Column(String(50), default="")
    province = Column(String(50), default="")
    region = Column(String(50), default="")
    regions = Column(Text, default="[]")
    phone = Column(String(20), default="")
    org_name = Column(String(100), default="")  # 单位名称（普通用户/业务员）
    valid_from = Column(DateTime, nullable=True)  # 账户有效期开始
    valid_until = Column(DateTime, nullable=True)  # 账户有效期结束
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    is_active = Column(Boolean, default=True)

    manager_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # 上级负责人（业务经理）
    region_id = Column(Integer, ForeignKey("regions.id"), nullable=True)  # 绑定的区域节点
    creator = relationship("User", remote_side=[id], foreign_keys=[created_by], backref="created_users")
    manager = relationship("User", remote_side=[id], foreign_keys=[manager_id])
    knowledge_base_bindings = relationship("KnowledgeBaseBinding", back_populates="user")
    inventories = relationship("Inventory", back_populates="user", foreign_keys="Inventory.user_id")


class KnowledgeBase(Base):
    __tablename__ = "knowledge_bases"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text, default="")
    prompt_config = Column(Text, default="")  # 自定义回复规则配置
    negative_prompt = Column(Text, default="")  # 禁止回复内容
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    documents = relationship("KnowledgeDocument", back_populates="knowledge_base")
    bindings = relationship("KnowledgeBaseBinding", back_populates="knowledge_base")


class KnowledgeDocument(Base):
    __tablename__ = "knowledge_documents"
    id = Column(Integer, primary_key=True, index=True)
    knowledge_base_id = Column(Integer, ForeignKey("knowledge_bases.id"), nullable=False)
    filename = Column(String(255), nullable=False)
    file_path = Column(String(500), nullable=False)
    file_type = Column(String(50), default="")
    parsed_content = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)

    knowledge_base = relationship("KnowledgeBase", back_populates="documents")


class KnowledgeBaseBinding(Base):
    __tablename__ = "knowledge_base_bindings"
    id = Column(Integer, primary_key=True, index=True)
    knowledge_base_id = Column(Integer, ForeignKey("knowledge_bases.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    knowledge_base = relationship("KnowledgeBase", back_populates="bindings")
    user = relationship("User", back_populates="knowledge_base_bindings")


class Consultation(Base):
    __tablename__ = "consultations"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    knowledge_base_id = Column(Integer, ForeignKey("knowledge_bases.id"), nullable=True)
    question = Column(Text, nullable=False)
    answer = Column(Text, nullable=False)
    tongue_analysis = Column(Text, default="")  # 舌象辨析结果
    syndrome_analysis = Column(Text, default="")  # 中医辨证结果
    symptoms = Column(Text, default="")  # JSON array of symptoms
    saved_locally = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", foreign_keys=[user_id])


class LocalCase(Base):
    __tablename__ = "local_cases"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    consultation_id = Column(Integer, ForeignKey("consultations.id"), nullable=True)
    patient_name = Column(String(50), default="")
    patient_gender = Column(String(10), default="")
    patient_age = Column(String(20), default="")
    patient_phone = Column(String(30), default="")
    patient_address = Column(String(200), default="")
    question = Column(Text, default="")
    answer = Column(Text, default="")
    tongue_analysis = Column(Text, default="")
    syndrome_analysis = Column(Text, default="")
    symptoms = Column(Text, default="")
    tongue_image_path = Column(String(500), default="")
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", foreign_keys=[user_id])


class TongueImage(Base):
    __tablename__ = "tongue_images"
    id = Column(Integer, primary_key=True, index=True)
    consultation_id = Column(Integer, ForeignKey("consultations.id"), nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    image_data = Column(LargeBinary, nullable=True)
    image_path = Column(String(500), default="")
    analysis_result = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)

class Inventory(Base):
    __tablename__ = "inventory"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)  # 属于哪个客户
    knowledge_base_id = Column(Integer, ForeignKey("knowledge_bases.id"), nullable=True)  # 关联知识库（产品来源）
    product_name = Column(String(100), nullable=False)  # 产品名称
    specification = Column(String(100), default="")  # 规格/型号
    quantity = Column(Integer, default=0)  # 数量
    unit = Column(String(20), default="")  # 单位
    price = Column(Float, default=0)  # 价格
    cost_price = Column(Float, default=0)  # 成本价
    notes = Column(Text, default="")  # 备注
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)  # 由谁添加
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", foreign_keys=[user_id])
    creator = relationship("User", foreign_keys=[created_by])
    knowledge_base = relationship("KnowledgeBase", foreign_keys=[knowledge_base_id])


class Region(Base):
    __tablename__ = "regions"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    parent_id = Column(Integer, ForeignKey("regions.id"), nullable=True)
    level = Column(String(20), nullable=False, default="district")  # headquarters, province, district, county, user_area
    sort_order = Column(Integer, default=0)
    knowledge_base_id = Column(Integer, ForeignKey("knowledge_bases.id"), nullable=True)
    # children loaded via API tree building, not ORM relationship
