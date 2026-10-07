# network-configuration

个人网络配置合集：代理客户端插件、脚本、规则等。

## 目录

| 路径 | 说明 |
| --- | --- |
| `Loon/Plugins/` | Loon 插件 |
| `Loon/Scripts/` | Loon 插件使用的脚本及其源码 |

## 内容

### Loon

- **Provider Parser**：订阅（远程节点）解析器。基于 Sub-Store 引擎拉取与转换订阅，再统一处理排除、正则重命名、去旗帜、去地区、前后缀、排序、去重。
  - 插件链接：`https://raw.githubusercontent.com/vimcaw/network-configuration/main/Loon/Plugins/ProviderParser.plugin`
  - 详细说明：[Loon/Plugins/ProviderParser.md](Loon/Plugins/ProviderParser.md)

## 注意

- 插件通过 GitHub raw 链接加载，生成的脚本文件（如 `Loon/Scripts/ProviderParser.js`）需要提交到 `main` 分支。
- 不要提交真实的订阅链接、密钥等私密信息；本地配置请用 `config.json` 或 `*.local.*` 命名（已被 `.gitignore` 忽略）。

## 许可证

[AGPL-3.0](LICENSE)

本仓库使用 AGPL-3.0，原因是构建产物 `Loon/Scripts/ProviderParser.js` 内嵌了 [Sub-Store](https://github.com/sub-store-org/Sub-Store) 的解析器代码，而 Sub-Store 以 AGPL-3.0 发布。这部分代码的使用、修改和再分发须遵守 AGPL-3.0，包括保留版权与许可声明、以相同许可证公开修改后的源码。
