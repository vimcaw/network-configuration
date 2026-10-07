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

插件页面上的参数是全局默认值；每个订阅还可以在自己的插件参数里单独修改（见下方“单个订阅的单独配置”）。

| 参数 | 说明 |
| --- | --- |
| `name` | 订阅名称，如 `机场 A`，供下面两个开关使用 |
| `aliasPrefix` / `aliasSuffix` | 开关：把订阅名称加到节点名前/后 |
| `aliasSep` | 订阅名称与节点名之间的分隔符，默认空格 |
| `prefix` / `suffix` | 自定义前/后缀文本，原样拼接；填写后优先于对应的开关 |
| `noFlag` | 去掉国旗 Emoji |
| `noRegion` | 去掉地区名（中文、英文、`HK`/`HKG` 等大写代码；代码前后必须不是字母，`PLUS` 里的 `US` 不会被误删） |
| `rename` | 正则重命名，见下文 |
| `exclude` | 排除关键字，英文逗号分隔，不区分大小写；`/正则/flags` 为正则 |
| `sort` | `不排序` `地区` `关键字` `名称升序` `名称降序` `倍率升序` `倍率降序`（也可写 `none` `region` `keyword` `name` `nameDesc` `rate` `rateDesc`） |
| `sortKeys` | 排序方式为“关键字”时的顺序，英文逗号分隔，支持 `/正则/` |
| `resourceUrlOnly` `ua` `timeout` `noCache` `ageSecretKey`（也接受 `age-secret-key`） | 原样交给 Sub-Store 引擎，含义同 Sub-Store 官方解析器 |
| `configUrl` | 远程配置 JSON 的地址 |
| `debug` | 在日志里打印订阅名称和生效配置 |

### 正则重命名

```
匹配 -> 替换 ; 匹配 -> 替换
```

- 多条规则用英文分号 `;` 或换行分隔，按顺序执行，每条都是全局替换。
- 匹配部分就是正则；需要标志时写成 `/iplc/i -> 专线`。普通文字直接写即可，`. + ( )` 等符号需要 `\` 转义。
- 替换支持 `$1` `$2` `$<name>` `$&`；替换留空表示删除。
- 例：`(香港|日本)\s*(\d+) -> $2-$1` 把 `香港 01` 改成 `01-香港`。

## 单个订阅的单独配置

在订阅设置里选择本解析器后，Loon 会为每个订阅单独保存一份插件参数（按订阅 URL 区分）。在该订阅的插件参数里修改的值只作用于这个订阅，没改过的订阅用插件页面的全局值。

### 订阅名称

Loon 不会把订阅（`[Remote Proxy]` 里等号左边的名称，如 `机场 A`）传给解析器：解析器脚本只能拿到 `$resource` `$resourceType` `$resourceUrl` `$argument` `$script`（其中 `name` 是解析器自己的标签）`$environment` `$loon`。所以要用名称做前后缀，需要：

1. 在该订阅的插件参数里填写“订阅名称”，如 `机场 A`；
2. 打开“名称作为前缀”或“名称作为后缀”（可以在全局打开，对所有订阅生效）。

开关打开但没有填写名称时，节点名不变，日志里会提示。

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

- `subscriptions` 的键匹配订阅名称 `name`（不区分大小写），或订阅 URL 中包含的文本；匹配项里也可以设置 `name`。
- 完整优先级：插件参数（全局或该订阅的） < 远程 `global` < 远程 `subscriptions` 匹配项。
- 拉取失败时使用上次成功的缓存。

## 许可

本仓库以 AGPL-3.0 发布（见根目录 `LICENSE`）。`ProviderParser.js` 内嵌的 [Sub-Store](https://github.com/sub-store-org/Sub-Store) 解析器代码同样是 AGPL-3.0。
