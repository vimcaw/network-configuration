# Loon Provider Parser

Loon 订阅（远程节点）解析器插件。Sub-Store 引擎负责拉取、解码、age 解密并转换成 Loon 节点，本插件在此基础上统一处理节点名称、过滤和排序。

## 文件

| 文件 | 说明 |
| --- | --- |
| `Loon/Plugins/ProviderParser.plugin` | Loon 插件 |
| `Loon/Scripts/ProviderParser.js` | 插件加载的脚本（内嵌 Sub-Store 引擎），由 `build.js` 生成 |
| `Loon/Scripts/ProviderParser/parser.js` | 本插件自己的逻辑源码 |
| `Loon/Scripts/ProviderParser/build.js` | `node build.js` 下载最新 Sub-Store 解析器并重新生成 `../ProviderParser.js` |
| `Loon/Scripts/ProviderParser/test.js` | `node test.js src` / `node test.js dist` 在模拟的 Loon 环境里跑测试 |
| `Loon/Scripts/ProviderParser/config.example.json` | 远程配置示例 |

## 安装

1. 在仓库根目录运行 `node Loon/Scripts/ProviderParser/build.js`，生成 `Loon/Scripts/ProviderParser.js`（需要能访问 GitHub）。
2. 提交并推送到 `vimcaw/network-configuration` 的 `main` 分支（仓库需公开，Loon 才能读取 raw 链接）。
3. 在 Loon 中导入插件：`https://raw.githubusercontent.com/vimcaw/network-configuration/main/Loon/Plugins/ProviderParser.plugin`
4. 在订阅（远程节点）设置里启用解析器并选择 “Provider Parser”。

修改 `parser.js` 后要重新运行 `build.js` 生成 `ProviderParser.js`；想跟进 Sub-Store 新版本时也是运行它。

## 处理顺序

排除（按原始名称） → 正则重命名 → 去旗帜 → 去地区 → 整理多余空格和分隔符 → 加前/后缀 → 排序 → 重名加序号

## 参数

插件页面上的参数是全局配置，作用于所有使用本解析器的订阅。

| 参数 | 说明 |
| --- | --- |
| `aliasPrefix` / `aliasSuffix` | 开关：把订阅别名加到节点名前/后 |
| `aliasSep` | 别名与节点名之间的分隔符，默认空格 |
| `prefix` / `suffix` | 自定义前/后缀文本（单独配置用，优先于别名开关；写 `prefix=` 表示该订阅不加前缀） |
| `name` | 该订阅的别名（见下方“订阅别名”） |
| `noFlag` | 去掉国旗 Emoji |
| `noRegion` | 去掉地区名（中文、英文、`HK`/`HKG` 等大写代码；代码前后必须不是字母，`PLUS` 里的 `US` 不会被误删） |
| `rename` | 正则重命名，见下文 |
| `exclude` | 排除关键字，英文逗号分隔，不区分大小写；`/正则/flags` 为正则 |
| `sort` | `不排序` `地区` `关键字` `名称升序` `名称降序` `倍率升序` `倍率降序`（也可写 `none` `region` `keyword` `name` `nameDesc` `rate` `rateDesc`） |
| `sortKeys` | 排序方式为“关键字”时的顺序，英文逗号分隔，支持 `/正则/` |
| `resourceUrlOnly` `ua` `timeout` `noCache` `ageSecretKey`（也接受 `age-secret-key`） | 原样交给 Sub-Store 引擎，含义同 Sub-Store 官方解析器 |
| `configUrl` | 远程配置 JSON 的地址 |
| `debug` | 在日志里打印生效配置和可用的全局变量 |

### 正则重命名

```
匹配 -> 替换 ; 匹配 -> 替换
```

- 多条规则用英文分号 `;` 或换行分隔，按顺序执行，每条都是全局替换。
- 匹配部分就是正则；需要标志时写成 `/iplc/i -> 专线`。普通文字直接写即可，`. + ( )` 等符号需要 `\` 转义。
- 替换支持 `$1` `$2` `$<name>` `$&`；替换留空表示删除。
- 例：`(香港|日本)\s*(\d+) -> $2-$1` 把 `香港 01` 改成 `01-香港`。

## 单个订阅的单独配置

单独配置的优先级高于全局。使用 Loon 订阅行的 `argument` 参数，格式是 `k=v&k=v`（Sub-Store 的约定），值里的 `&` 写成 `%26`：

```ini
[Remote Proxy]
机场A = https://example.com/sub?token=xxx,parser-enabled=true,parser-plugin=Provider Parser,argument="name=机场A&prefix=A·&exclude=到期,剩余流量&sort=倍率升序"
```

也可以写在订阅地址的 `#` 片段里（片段不会发给服务器，解析器会在拉取前去掉它）：

```
https://example.com/sub?token=xxx#prefix=A·&noFlag
```

布尔开关只写键名即为开启，如 `#noFlag`。

> Loon 的文档没有说明订阅 `argument` 与插件参数如何合并。如果 Loon 用订阅的 argument 整体替换插件参数，脚本会用上一次运行时缓存的插件参数补齐全局配置，所以修改全局参数后，最好先刷新一个没有单独配置的订阅。

### 订阅别名

Loon 目前没有公开文档说明解析器能拿到订阅名称。脚本会尝试读取几个可能的变量；拿不到时，请在该订阅的单独配置里写 `name=别名`。打开 `debug` 后日志会列出 Loon 实际提供的全部 `$` 变量。

## 远程配置与多设备同步

插件参数存储在各设备的 Loon 里，脚本无法控制它们是否同步。如果需要多设备一致，可以把设置写进一个 JSON 文件（例如私有 Gist 的 raw 链接），在 `configUrl` 里填它的地址：

```json
{
  "global": { "noFlag": true, "sort": "地区" },
  "subscriptions": {
    "机场A": { "prefix": "A·" },
    "sub.example.com": { "exclude": "到期" }
  }
}
```

- `subscriptions` 的键匹配订阅别名（不区分大小写），或订阅 URL 中包含的文本。
- 完整优先级：插件参数 < 远程 `global` < 远程 `subscriptions` 匹配项 < 订阅 `argument` < 订阅 URL `#` 片段。
- 拉取失败时使用上次成功的缓存。

## 许可

本仓库以 AGPL-3.0 发布（见根目录 `LICENSE`）。`ProviderParser.js` 内嵌的 [Sub-Store](https://github.com/sub-store-org/Sub-Store) 解析器代码同样是 AGPL-3.0。
