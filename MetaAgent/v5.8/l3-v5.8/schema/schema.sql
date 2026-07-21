-- MetaAgent v5.8 数据库 DDL
-- 21 张表，对齐态控附录 v5.8
-- 执行: sqlite3 metaagent.db < schema.sql

          // 多语句分割：按分号分隔每条 CREATE TABLE，分别注册表名
      CREATE TABLE IF NOT EXISTS analyzing_contract_in (
      CREATE TABLE IF NOT EXISTS analyzing_contract_out (
      CREATE TABLE IF NOT EXISTS sessions (
      CREATE TABLE IF NOT EXISTS topicEvolution (
      CREATE TABLE IF NOT EXISTS topicEvolutionEvent (
      CREATE TABLE IF NOT EXISTS topicEvolutionArchive (
      CREATE TABLE IF NOT EXISTS domainRules (
      CREATE TABLE IF NOT EXISTS ruleCandidates (
      CREATE TABLE IF NOT EXISTS ruleMiningQueue (
      CREATE TABLE IF NOT EXISTS sessionCheckpoints (
      CREATE TABLE IF NOT EXISTS roomConversationLog (
      CREATE TABLE IF NOT EXISTS conversationArchive (
      CREATE TABLE IF NOT EXISTS roomStateIndex (
      CREATE TABLE IF NOT EXISTS outputRegistry (
      CREATE TABLE IF NOT EXISTS outputs (
      CREATE TABLE IF NOT EXISTS projectRegistry (
      CREATE TABLE IF NOT EXISTS userLastProject (
      CREATE TABLE IF NOT EXISTS conversation_log (