-- ============================================================
-- WeftCount · 表结构（Schema）
-- ============================================================
-- 本文件由**真实数据库导出**（mysqldump --no-data），与当前代码 100%一致。
-- 26 张表：租户/公司/角色/用户、物料与坯布规格、库存三件套(批次/流水/单据)、
-- 件卡(rolls) 与件卡出库流水、生产(机台/工单/报工)、订单/合同、盘点、
-- 审计、预警、条码映射。
--
-- 列名约定：实体用驼峰，数据库列由 WeftNamingStrategy 自动转下划线
--         （entity 里的 property 名 = DB 的 snake_case 列名）。
--
-- 两条建库路径（见 sql/README.md）：
--   A. 直接导入本文件 + 03_demo_data.sql   —— 快速、无需跑 Node
--   B. TypeORM 迁移 + seed                  —— 与开发流程一致
-- 两者结构相同；**升级已有库请走 B**（迁移会保留历史数据）。
--
-- 用法：
--   mysql -h127.0.0.1 -uroot -p weft_count < sql/02_schema.sql
-- ============================================================

-- 建表期间关闭外键检查：mysqldump 按字母序输出，子表可能先于父表建（alerts/companies
-- 引用 tenants），不关会报 ERROR 1824 Failed to open the referenced table。
SET FOREIGN_KEY_CHECKS = 0;

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `alerts` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tenant_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `type` enum('order_overdue','low_stock','stale_batch') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '预警类型',
  `severity` enum('info','warning','critical') COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `message` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ref_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ref_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `acknowledged` tinyint(1) NOT NULL DEFAULT '0',
  `acknowledged_by` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `acknowledged_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `data` json DEFAULT NULL COMMENT '结构化附加数据(低库存预警带补货建议)',
  PRIMARY KEY (`id`),
  KEY `idx_alerts_company_ack` (`company_id`,`acknowledged`),
  KEY `idx_alerts_dedup` (`company_id`,`type`,`ref_id`,`acknowledged`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='预警中心';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_logs` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tenant_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `username` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `real_name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `module` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `summary` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `target_type` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `target_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `http_method` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL,
  `path` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ip` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_agent` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `diff` json DEFAULT NULL,
  `duration_ms` int DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_audit_logs_tenant_company` (`tenant_id`,`company_id`,`created_at`),
  KEY `idx_audit_logs_target` (`tenant_id`,`target_type`,`target_id`),
  KEY `idx_audit_logs_user` (`tenant_id`,`user_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='审计日志，只增不改不删';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `companies` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tenant_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tax_no` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `address` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('active','closed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `coefficients` json DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `alert_ack_silence_days` int NOT NULL DEFAULT '7' COMMENT '预警确认后静默天数(按公司,0=不静默)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_companies_code_tenant` (`code`,`tenant_id`),
  KEY `idx_companies_tenant` (`tenant_id`),
  CONSTRAINT `fk_companies_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `contract_items` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tenant_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `contract_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `material_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `spec_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `agreed_price` decimal(14,4) NOT NULL COMMENT '协议单价(元/米)',
  `agreed_quantity_m` decimal(16,3) NOT NULL COMMENT '协议数量(米)',
  `amount` decimal(18,2) NOT NULL COMMENT '行金额=单价*数量',
  `remark` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_cti_contract` (`contract_id`),
  KEY `idx_cti_spec` (`company_id`,`spec_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同明细行(物料+规格+协议价)';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `contracts` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tenant_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `contract_no` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'HT+日期+流水',
  `contract_type` enum('purchase','sales') COLLATE utf8mb4_unicode_ci NOT NULL,
  `partner_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `partner_name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '往来单位名称快照',
  `status` enum('draft','active','completed','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `total_quantity_m` decimal(16,3) NOT NULL DEFAULT '0.000' COMMENT '协议总数量(米)=明细合计',
  `total_amount` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '协议总金额(元)=明细合计',
  `start_date` date DEFAULT NULL,
  `end_date` date DEFAULT NULL,
  `remark` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `version` int NOT NULL DEFAULT '1',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ct_no_company` (`contract_no`,`company_id`),
  KEY `idx_ct_company` (`company_id`),
  KEY `idx_ct_partner` (`company_id`,`partner_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='采购/销售合同(框架协议)';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `greige_specs` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tenant_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `finished_width` decimal(8,2) NOT NULL COMMENT '成品门幅 cm',
  `warp_density` decimal(8,2) NOT NULL COMMENT '经密 根/英寸',
  `weft_density` decimal(8,2) NOT NULL COMMENT '纬密 根/英寸',
  `weave_type` enum('plain','twill','satin','jacquard','leno','pile') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'plain',
  `warp_count_value` decimal(10,2) NOT NULL,
  `warp_count_system` enum('NeS','Nm','Tex','D') COLLATE utf8mb4_unicode_ci NOT NULL,
  `weft_count_value` decimal(10,2) NOT NULL,
  `weft_count_system` enum('NeS','Nm','Tex','D') COLLATE utf8mb4_unicode_ci NOT NULL,
  `warp_material_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `weft_material_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `loom_width` decimal(8,2) DEFAULT NULL,
  `width_allowance` decimal(6,2) NOT NULL DEFAULT '10.00',
  `warp_loss_rate` decimal(6,4) NOT NULL DEFAULT '0.0550',
  `weft_loss_rate` decimal(6,4) NOT NULL DEFAULT '0.0500',
  `learned_loss_factor` decimal(6,4) DEFAULT NULL COMMENT '实测校准系数(领用米/报工米),算快照时折算有效损耗',
  `learned_at` datetime DEFAULT NULL COMMENT '系数最近学习时间',
  `learned_sample_size` int DEFAULT NULL COMMENT '学习时样本笔数',
  `picks_per_minute` int DEFAULT NULL,
  `machine_run_rate` decimal(5,4) NOT NULL DEFAULT '0.8500',
  `calculated_gsm` decimal(8,2) NOT NULL COMMENT '内核计算克重，业务不得手填',
  `measured_gsm` decimal(8,2) DEFAULT NULL COMMENT '出厂实测克重，用于校准',
  `last_snapshot` json DEFAULT NULL,
  `status` enum('active','discontinued') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `remark` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `spec_version` int NOT NULL DEFAULT '1',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `overhead_cost_per_meter` decimal(10,4) NOT NULL DEFAULT '0.0000' COMMENT '加工费(元/米)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_greige_specs_code_company` (`code`,`company_id`),
  KEY `idx_greige_specs_company` (`company_id`),
  KEY `idx_greige_specs_warp_material` (`warp_material_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='坯布规格，克重由工艺内核计算';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inventory_batches` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tenant_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `batch_no` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `material_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `spec_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `warehouse_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '所属仓库',
  `width_cm` decimal(8,2) NOT NULL,
  `spec_snapshot` json NOT NULL,
  `quantity` decimal(14,3) NOT NULL COMMENT '入库数量(米)',
  `weight_kg` decimal(14,3) NOT NULL COMMENT '入库重量 kg',
  `area_m2` decimal(14,4) NOT NULL COMMENT '入库面积 m²',
  `remaining_quantity` decimal(14,3) NOT NULL,
  `remaining_weight_kg` decimal(14,3) NOT NULL,
  `remaining_area_m2` decimal(14,4) NOT NULL,
  `unit_cost` decimal(14,4) DEFAULT NULL,
  `source_type` enum('purchase_inbound','production_in','stock_transfer','stock_adjust','count_gain') COLLATE utf8mb4_unicode_ci NOT NULL,
  `source_doc_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('normal','frozen','depleted') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'normal',
  `inbound_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_batches_company` (`company_id`),
  KEY `idx_batches_material` (`company_id`,`material_id`),
  KEY `idx_batches_spec` (`company_id`,`spec_id`),
  KEY `idx_batches_warehouse` (`company_id`,`warehouse_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='库存批次，主单位米，冗余kg/m2视图';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inventory_documents` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `client_request_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '客户端幂等键(重放复用同值,防重复出入库)',
  `tenant_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `doc_no` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `doc_type` enum('purchase_inbound','production_issue','sales_outbound') COLLATE utf8mb4_unicode_ci NOT NULL,
  `material_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `spec_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `width_cm` decimal(8,2) NOT NULL,
  `spec_snapshot` json NOT NULL,
  `entered_unit` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '录入单位 kg/m/m2',
  `entered_value` decimal(14,4) NOT NULL,
  `quantity_m` decimal(14,3) NOT NULL COMMENT '折算主单位(米)',
  `weight_kg` decimal(14,3) NOT NULL COMMENT '折算重量 kg',
  `area_m2` decimal(14,4) NOT NULL COMMENT '折算面积 m²',
  `unit_price` decimal(14,4) DEFAULT NULL,
  `total_amount` decimal(16,2) DEFAULT NULL,
  `partner_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '往来单位(供应商/客户) id',
  `partner_name` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '往来单位名称快照',
  `order_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '关联订单(trade_orders.id)',
  `order_item_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '履约的订单明细行(多明细订单按行算进度)',
  `operator_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `remark` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_docs_no_company` (`doc_no`,`company_id`),
  UNIQUE KEY `uq_inv_docs_client_req` (`company_id`,`client_request_id`),
  KEY `idx_docs_company` (`company_id`),
  KEY `idx_docs_type` (`company_id`,`doc_type`),
  KEY `idx_docs_spec` (`company_id`,`spec_id`),
  KEY `idx_docs_partner` (`company_id`,`partner_id`),
  KEY `idx_docs_order` (`company_id`,`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='库存单据，采购/领用/销售共用';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inventory_transactions` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tenant_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `batch_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `material_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `spec_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `direction` enum('in','out') COLLATE utf8mb4_unicode_ci NOT NULL,
  `txn_type` enum('purchase_in','production_in','material_issue','sales_out','stock_adjust','stock_transfer','count_gain','count_loss','scrap') COLLATE utf8mb4_unicode_ci NOT NULL,
  `change_quantity` decimal(14,3) NOT NULL COMMENT '变化量(米)',
  `change_weight_kg` decimal(14,3) NOT NULL,
  `change_area_m2` decimal(14,4) NOT NULL,
  `after_quantity` decimal(14,3) NOT NULL,
  `after_weight_kg` decimal(14,3) NOT NULL,
  `after_area_m2` decimal(14,4) NOT NULL,
  `unit_price` decimal(14,4) DEFAULT NULL,
  `doc_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `operator_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `remark` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_txn_company` (`company_id`),
  KEY `idx_txn_batch` (`company_id`,`batch_id`),
  KEY `idx_txn_doc` (`company_id`,`doc_id`),
  KEY `idx_txn_created` (`company_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='库存事务流水，三视图齐全';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `machines` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tenant_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `model` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('idle','running','maintenance','retired') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'idle',
  `remark` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_machines_code_company` (`code`,`company_id`),
  KEY `idx_machines_company` (`company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='机台(织机)主数据';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `materials` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tenant_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` enum('yarn','greige','finished','auxiliary','spare') COLLATE utf8mb4_unicode_ci NOT NULL,
  `specification` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `measure_mode` enum('weight','length','area','count') COLLATE utf8mb4_unicode_ci NOT NULL,
  `primary_unit` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `allowed_units` json NOT NULL,
  `batch_managed` tinyint(1) NOT NULL DEFAULT '1',
  `safety_stock` decimal(14,4) DEFAULT NULL,
  `lead_time_days` decimal(6,2) DEFAULT NULL COMMENT '采购提前期/采购周期(天),补货点计算用',
  `standard_price` decimal(14,4) DEFAULT NULL,
  `status` enum('active','discontinued') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `remark` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_materials_code_company` (`code`,`company_id`),
  KEY `idx_materials_company` (`company_id`),
  KEY `idx_materials_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='物料主数据';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `migrations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `timestamp` bigint NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=27 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `partners` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tenant_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `type` enum('supplier','customer','both') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'supplier',
  `contact` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tax_no` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `address` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bank_name` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bank_account` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('active','disabled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `remark` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_partners_code_company` (`code`,`company_id`),
  KEY `idx_partners_company` (`company_id`),
  KEY `idx_partners_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='往来单位，供应商/客户共用';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `production_orders` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tenant_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `order_no` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'SC+日期+流水',
  `material_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '产出物料(坯布)',
  `spec_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `spec_snapshot` json NOT NULL,
  `planned_quantity_m` decimal(14,3) NOT NULL COMMENT '计划产量(米)',
  `produced_quantity_m` decimal(14,3) NOT NULL DEFAULT '0.000' COMMENT '累计产出(米)',
  `machine_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '指派机台',
  `status` enum('draft','scheduled','in_progress','completed','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `planned_start_date` date DEFAULT NULL,
  `due_date` date DEFAULT NULL,
  `remark` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `version` int NOT NULL DEFAULT '1',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_prod_no_company` (`order_no`,`company_id`),
  KEY `idx_prod_company` (`company_id`),
  KEY `idx_prod_machine` (`company_id`,`machine_id`),
  KEY `idx_prod_status` (`company_id`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='生产工单，织造任务';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `production_reports` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `client_request_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '客户端幂等键(重试复用同值,防重复计量)',
  `tenant_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `order_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `machine_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `report_date` date NOT NULL,
  `output_m` decimal(14,3) NOT NULL COMMENT '实际产出(米)',
  `stoppage_minutes` int DEFAULT NULL,
  `stop_reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `operator_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_prod_reports_client_req` (`company_id`,`client_request_id`),
  KEY `idx_reports_order` (`company_id`,`order_id`),
  KEY `idx_reports_machine_date` (`company_id`,`machine_id`,`report_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='挡车工报工记录';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `roles` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tenant_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `permissions` json NOT NULL,
  `builtin` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_roles_code_tenant` (`code`,`tenant_id`),
  KEY `idx_roles_tenant` (`tenant_id`),
  CONSTRAINT `fk_roles_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `roll_outbounds` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tenant_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `roll_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '件卡',
  `doc_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '出库单(发货/领用)',
  `meters` decimal(14,3) NOT NULL COMMENT '本次出库米数',
  `weight_kg` decimal(14,3) DEFAULT NULL,
  `area_m2` decimal(14,3) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_roll_outbounds_roll` (`company_id`,`roll_id`),
  KEY `idx_roll_outbounds_doc` (`company_id`,`doc_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='件卡出库流水(一匹可多次)';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `rolls` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tenant_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `batch_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属批次',
  `roll_no` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '件卡序列号(公司内唯一,防重扫)',
  `meters` decimal(14,3) NOT NULL COMMENT '该匹米数',
  `remaining_m` decimal(14,3) DEFAULT NULL COMMENT '剩余米数(拆匹后递减,0=已发完)',
  `weight_kg` decimal(14,3) DEFAULT NULL,
  `remaining_kg` decimal(14,3) DEFAULT NULL COMMENT '剩余重量(kg)',
  `status` enum('in_stock','consumed','sold') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'in_stock',
  `source_doc_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `outbound_doc_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '出库单(发货/领用写入)',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_rolls_rollno` (`company_id`,`roll_no`),
  KEY `idx_rolls_batch` (`company_id`,`batch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='件卡(逐匹)';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `stocktake_items` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tenant_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `stocktake_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `batch_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `roll_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '件卡(非空=件卡级盘点,可定位到匹)',
  `roll_no` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '件卡号(冗余,便于打印/核对)',
  `batch_no` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '批次号快照',
  `book_quantity_m` decimal(14,3) NOT NULL COMMENT '账面剩余量快照(米)',
  `counted_quantity_m` decimal(14,3) DEFAULT NULL COMMENT '实盘量(米)',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_sti_stocktake` (`stocktake_id`),
  KEY `idx_sti_batch` (`stocktake_id`,`batch_id`),
  KEY `idx_stocktake_items_roll` (`company_id`,`roll_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='盘点明细';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `stocktakes` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tenant_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `stocktake_no` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'PD+日期+流水',
  `warehouse_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `stocktake_date` date NOT NULL,
  `status` enum('draft','completed','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `operator_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `remark` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `version` int NOT NULL DEFAULT '1',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_st_no_company` (`stocktake_no`,`company_id`),
  KEY `idx_st_company` (`company_id`),
  KEY `idx_st_warehouse` (`company_id`,`warehouse_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='盘点单';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `supplier_code_mappings` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tenant_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `supplier_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `supplier_code` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '供应商条码(收货时扫到的码)',
  `material_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `spec_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `remark` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_scm` (`company_id`,`supplier_id`,`supplier_code`),
  KEY `idx_scm_company` (`company_id`),
  KEY `idx_scm_code` (`company_id`,`supplier_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='供应商条码→物料/规格映射(扫码入库)';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tenants` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `plan` enum('basic','professional','flagship') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'basic',
  `status` enum('active','suspended','expired') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `max_companies` int NOT NULL DEFAULT '1',
  `max_users` int NOT NULL DEFAULT '5',
  `default_coefficients` json DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenants_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `trade_order_items` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tenant_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `order_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `material_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `spec_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `spec_snapshot` json NOT NULL,
  `ordered_unit` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ordered_value` decimal(14,4) NOT NULL,
  `quantity_m` decimal(14,3) NOT NULL,
  `weight_kg` decimal(14,3) NOT NULL,
  `area_m2` decimal(14,4) NOT NULL,
  `unit_price` decimal(14,4) DEFAULT NULL,
  `line_amount` decimal(18,2) DEFAULT NULL,
  `contract_item_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_oti_order` (`order_id`),
  KEY `idx_oti_spec` (`company_id`,`spec_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='订单明细行';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `trade_orders` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tenant_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `order_no` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'PO/SO + 日期 + 流水',
  `order_type` enum('purchase','sales') COLLATE utf8mb4_unicode_ci NOT NULL,
  `partner_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `partner_name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '往来单位名称快照',
  `total_quantity_m` decimal(16,3) NOT NULL DEFAULT '0.000' COMMENT '汇总数量(米)=明细合计',
  `total_amount` decimal(16,2) DEFAULT NULL,
  `contract_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '来源合同(可选)',
  `source_alert_id` char(36) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '来源补货预警id(防重复生成+回溯建议来源)',
  `status` enum('draft','confirmed','completed','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `expected_date` date DEFAULT NULL COMMENT '交期',
  `remark` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `version` int NOT NULL DEFAULT '1',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_orders_no_company` (`order_no`,`company_id`),
  KEY `idx_orders_company` (`company_id`),
  KEY `idx_orders_type` (`company_id`,`order_type`),
  KEY `idx_orders_partner` (`company_id`,`partner_id`),
  KEY `idx_orders_status` (`company_id`,`status`),
  KEY `idx_orders_source_alert` (`company_id`,`source_alert_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='采购/销售订单，计划层';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tenant_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `username` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `real_name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('active','disabled','locked') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `company_ids` json NOT NULL,
  `role_codes` json NOT NULL,
  `last_login_at` datetime DEFAULT NULL,
  `password_changed_at` datetime DEFAULT NULL,
  `failed_attempts` int NOT NULL DEFAULT '0',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_users_username` (`username`),
  KEY `idx_users_tenant` (`tenant_id`),
  CONSTRAINT `fk_users_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `warehouses` (
  `id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tenant_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `company_id` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `type` enum('raw','greige','finished','auxiliary','scrap','other') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'other',
  `address` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `keeper` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('active','disabled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `remark` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_warehouses_code_company` (`code`,`company_id`),
  KEY `idx_warehouses_company` (`company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='仓库主数据';
/*!40101 SET character_set_client = @saved_cs_client */;

-- 恢复外键检查
SET FOREIGN_KEY_CHECKS = 1;
