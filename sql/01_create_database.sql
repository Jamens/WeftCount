-- ============================================================
-- WeftCount · 创建数据库
-- ============================================================
-- 用途：创建空库。表结构见 02_schema.sql，演示数据见 03_demo_data.sql
--       （或用TypeORM 迁移 + seed，见 sql/README.md）
--
-- 用法：
--   mysql -h127.0.0.1 -uroot -p < sql/01_create_database.sql
--
-- 注意：库名/账号/密码请按自己的环境修改；本文件不含任何本机凭证。
-- ============================================================

CREATE DATABASE IF NOT EXISTS `weft_count`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

-- utf8mb4 必需：坯布规格/物料名可能出现中文与特殊符号，utf8(3 字节)会存不下。
