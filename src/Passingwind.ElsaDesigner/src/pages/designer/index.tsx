import { ShowDownloadJsonFile } from '@/services/utils';
import {
    createWorkflowDefinition,
    getWorkflowDefinition,
    getWorkflowDefinitionVersion,
    getWorkflowDefinitionVersions,
    updateWorkflowDefinition,
} from '@/services/WorkflowDefinition';
import { GlobalOutlined, SaveOutlined } from '@ant-design/icons';
import { ModalForm } from '@ant-design/pro-form';
import { PageContainer } from '@ant-design/pro-layout';
import ProTable from '@ant-design/pro-table';
import { DagreLayout } from '@antv/layout';
import type { Node } from '@antv/x6';
import {
    Button,
    Card,
    Col,
    Dropdown,
    Form,
    Menu,
    message,
    Modal,
    Row,
    Spin,
    Tag,
    Tooltip,
    Typography,
    Upload,
} from 'antd';
import type { RcFile } from 'antd/lib/upload';
import { isArray } from 'lodash';
import React, { useEffect, useRef } from 'react';
import { useHistory, useLocation } from 'umi';
import EditFormItems from '../definition/edit-form-items';
import type { FlowActionType } from './flow';
import Flow from './flow';
import './index.less';
import NodePropForm from './node-prop-form';
import {
    conventToGraphData,
    conventToServerData,
    getNodeTypeRawData,
    getPropertySyntaxes,
} from './service';
import type {
    IGraphData,
    NodeEditFormData,
    NodeTypeProperty,
    NodeUpdateData,
    NodeUpdatePropData,
} from './type';

const Index: React.FC = () => {
    const location = useLocation();
    const history = useHistory();

    const flowAction = useRef<FlowActionType>();

    const [loading, setLoading] = React.useState(false);

    const [submiting, setSubmiting] = React.useState(false);
    const [id, setId] = React.useState<string>();
    const [version, setVersion] = React.useState<number>(1);
    const [, setDefinitionVersion] = React.useState<API.WorkflowDefinitionVersion>();
    const [definition, setDefinition] = React.useState<API.WorkflowDefinition>();

    const [oldVersion, setOldVersion] = React.useState<number>();

    const [graphData, setGraphData] = React.useState<IGraphData>();

    const [editModalTitle, setEditModalTitle] = React.useState<string>();
    const [editModalVisible, setEditModalVisible] = React.useState<boolean>(false);

    const [nodeTypePropFormTitle, setNodeTypePropFormTitle] = React.useState<string>('Property');
    const [nodeTypePropFormVisible, setNodeTypePropFormVisible] = React.useState<boolean>(false);
    const [nodeTypePropList, setNodeTypePropList] = React.useState<NodeTypeProperty[]>([]);
    const [nodeTypeDescriptor, setNodeTypeDescriptor] =
        React.useState<API.ActivityTypeDescriptor>();
    const [nodePropertySyntaxs, setNodePropertySyntaxs] =
        React.useState<Record<string, string[]>>();

    const [editNodeId, setEditNodeId] = React.useState<string>('');
    const [editNodeFormData, setEditNodeFormData] = React.useState<NodeEditFormData>();
    const [editNodeFormRef] = Form.useForm();

    const [versionListModalVisible, setVersionListModalVisible] = React.useState<boolean>(false);

    const loadServerData = async (
        definiton: API.WorkflowDefinitionVersion,
        autoLayout: boolean = false,
    ) => {
        const gData = await conventToGraphData(definiton.activities!, definiton.connections!);

        // if (item.sourceActivityId) sourceId = item.sourceActivityId;
        // if (item.targetActivityId) targetId = item.targetActivityId;

        // if (item.source) sourceId = item.source;
        // if (item.target) targetId = item.target;

        if (autoLayout) {
            const layout = new DagreLayout({
                type: 'dagre',
                rankdir: 'TB',
                nodesep: 60,
                ranksep: 40,
            });

            // @ts-ignore
            const newModel = layout.layout(gData);
            // @ts-ignore
            setGraphData(newModel);
        } else {
            setGraphData(gData);
        }
    };

    const handleOnExport = async () => {
        if (!definition) return;

        const result = await flowAction.current?.getGraphData();
        if (result) {
            const result2 = conventToServerData(result);
            ShowDownloadJsonFile(
                `${definition.name}-${version}.json`,
                JSON.stringify({
                    ...result2,
                    name: definition.name,
                    displayName: definition.displayName,
                    version: version,
                }),
            );
        } else {
            message.error('Get graph data failed');
        }
    };

    const handleOnImport = async (file: RcFile) => {
        try {
            const content = await file.text();
            const data = JSON.parse(content);
            const data2 = { connections: [], activities: data.activities };
            // compatible with offlice export json file
            if (data?.connections) {
                data2.connections = data.connections?.map((x: any) => {
                    return {
                        sourceId: x.sourceId ?? x.sourceActivityId,
                        targetId: x.targetId ?? x.targetActivityId,
                        outcome: x.outcome,
                    };
                });
            }

            await loadServerData(data2 as API.WorkflowDefinition, true);
            message.info('import successful.');
        } catch (error) {
            console.error(error);
            message.error('Import file failed');
        }

        // const result = await flowAction.current?.getGraphData();
    };

    // show node edit form
    // 显示节点属性编辑表单
    const handleOnShowNodeEditForm = async (nodeConfig: Node.Properties, node: Node) => {
        const loading2 = message.loading('Loading....');
        //
        setNodeTypePropFormTitle(`Properties - ${nodeConfig.displayName} (${nodeConfig.type})`);

        setEditNodeId(node.id);

        // load node type & peoperties
        const allNodeTypes = await getNodeTypeRawData();
        const nodeType = allNodeTypes.items?.find((x) => x.type == nodeConfig.type);

        if (!nodeType) {
            message.error(`The node type '${nodeConfig.type}' not found.`);
            return;
        }

        const propItems = (nodeType.inputProperties ?? [])
            .filter((x) => x.isBrowsable)
            .map((x) => {
                return {
                    ...x,
                    isRequired: x.isDesignerCritical,
                } as NodeTypeProperty;
            });

        // save to status
        setNodeTypePropList(propItems ?? []);

        // build node edit data
        const nodeData: NodeEditFormData = {
            name: node.getProp('name') ?? '',
            displayName: node.getProp('displayName') ?? '',
            description: node.getProp('description') ?? '',
            props: {},
        };

        setNodeTypeDescriptor(nodeType);

        // initial all form fields
        const propertySyntaxs = {};
        propItems?.forEach((propItem) => {
            //
            const propSyntax = getPropertySyntaxes(propItem);
            propertySyntaxs[propItem.name] = propSyntax.supports;
            const defaultSyntax = propSyntax.default;
            //
            const defaultValue: string | object | number | undefined =
                propItem.defaultValue ?? undefined;
            let syntaxStringValue: string = '';
            if (defaultValue) {
                if (typeof defaultValue == 'object') {
                    syntaxStringValue = JSON.stringify(defaultValue);
                } else if (defaultValue) {
                    syntaxStringValue = defaultValue?.toString();
                } else {
                    syntaxStringValue = '';
                }
            }

            if (defaultSyntax)
                nodeData.props[propItem.name] = {
                    syntax: 'Default',
                    value: defaultValue,
                    expressions: {
                        Default: defaultValue,
                        [defaultSyntax]: syntaxStringValue,
                    },
                };

            if (propSyntax.editor) {
                nodeData.props[propItem.name] = {
                    syntax: propSyntax.editor,
                    value: defaultValue,
                    expressions: {
                        Literal: syntaxStringValue,
                    },
                };
            }
        });

        setNodePropertySyntaxs(propertySyntaxs);

        // property
        const sourceProperties = (node.getProp('properties') ?? []) as NodeUpdatePropData[];
        console.debug('sourceProperties: ', sourceProperties);

        // convert to form data
        sourceProperties.forEach((item) => {
            const syntax = !item.syntax ? 'Default' : item.syntax;
            let syntaxValue: any = undefined;
            let expressionValue: string = '';

            // load syntax value
            let valueSyntax = '';
            if (Object.keys(item.expressions ?? {}).filter((x) => x != '$id').length > 0) {
                valueSyntax = Object.keys(item.expressions ?? {}).filter((x) => x != '$id')[0];
                expressionValue = item.expressions![valueSyntax];
            }

            if (syntax == 'Default') {
                const property = nodeType.inputProperties?.find((x) => x.name == item.name);
                // default
                syntaxValue = expressionValue;
                //
                if (property?.uiHint == 'check-list' || property?.uiHint == 'multi-text') {
                    if (
                        (expressionValue.startsWith('{') && expressionValue.endsWith('}')) ||
                        (expressionValue.startsWith('[') && expressionValue.endsWith(']'))
                    ) {
                        syntaxValue = JSON.parse(expressionValue);
                    }
                }
            }

            nodeData.props[item.name] = {
                ...nodeData.props[item.name],
                syntax: syntax,
                expressions: {
                    Default: syntaxValue,
                    [valueSyntax]: expressionValue,
                },
            };
        });

        setEditNodeFormData(nodeData);

        console.debug('load form data: ', nodeData);

        editNodeFormRef.resetFields();
        editNodeFormRef.setFieldsValue(nodeData);

        // show
        setNodeTypePropFormVisible(true);
        loading2();
    };

    // handle on node edit form submit
    // 更新节点数据
    const handleUpdateNodeProperties = async (formData: NodeEditFormData) => {
        console.debug('save form data: ', formData);
        const result: NodeUpdateData = {
            name: formData.name,
            displayName: formData.displayName,
            description: formData.description,
            properties: [],
            outcomes: [],
        };
        if (formData.props) {
            // as default, one syntax map one expressions key value
            // if not, use expressions first key as syntax and use expressions first value as value
            // if syntax is default, use expressions first key as syntax
            for (const name in formData.props ?? {}) {
                const curObj = formData.props[name];
                //
                let valueSyntaxName = curObj.syntax;
                let syntaxSourceValue: any = undefined;
                let sytaxStringValue: string = '';
                const expressions = curObj.expressions ?? {};
                const syntaxes = nodePropertySyntaxs![name];
                //
                if (curObj.expressions && Object.keys(expressions).length > 0) {
                    if (curObj.syntax == 'Default' && syntaxes.length > 0) {
                        valueSyntaxName = syntaxes[0];
                        syntaxSourceValue = curObj.expressions?.[curObj.syntax] ?? undefined;
                    } else {
                        syntaxSourceValue = curObj.expressions?.[valueSyntaxName] ?? undefined;
                    }
                    // special case
                    if (Object.keys(expressions).indexOf(curObj.syntax) == -1) {
                        // first key value
                        valueSyntaxName = Object.keys(expressions)[0];
                        syntaxSourceValue = curObj.expressions?.[valueSyntaxName] ?? undefined;
                    }

                    // server save value as string
                    if (syntaxSourceValue) {
                        if (typeof syntaxSourceValue == 'object')
                            sytaxStringValue = JSON.stringify(syntaxSourceValue);
                        else if (typeof syntaxSourceValue != 'string')
                            sytaxStringValue = syntaxSourceValue.toString();
                        else {
                            sytaxStringValue = syntaxSourceValue as string;
                        }
                    }

                    // end
                    result.properties.push({
                        name: name,
                        syntax:
                            curObj.syntax == 'Default'
                                ? undefined
                                : curObj.syntax == valueSyntaxName
                                ? valueSyntaxName
                                : undefined,
                        expressions: { [valueSyntaxName]: sytaxStringValue },
                        value: syntaxSourceValue,
                    });
                }
            }
        }

        // combination all output
        const outcomes = nodeTypeDescriptor?.outcomes ?? [];
        const outcomeValueProp = nodeTypePropList.find((x) => x.considerValuesAsOutcomes);

        if (outcomeValueProp) {
            const newValue = result.properties.find((x) => x.name == outcomeValueProp.name)?.value;
            if (newValue) {
                if (isArray<string>(newValue)) {
                    outcomes.push(...newValue);
                } else if (
                    typeof newValue == 'string' &&
                    newValue.startsWith('[') &&
                    newValue.endsWith(']')
                ) {
                    outcomes.push(...JSON.parse(newValue));
                }
            }
        }

        if (nodeTypeDescriptor?.type == 'Switch') {
            const newValue = result.properties.find((x) => x.name == 'Cases')?.value;
            if (newValue) {
                if (
                    typeof newValue == 'string' &&
                    newValue.startsWith('[') &&
                    newValue.endsWith(']')
                ) {
                    const o: string[] = JSON.parse(newValue).map((x: any) => {
                        return x.name;
                    });
                    outcomes.push(...o);
                }
            }
        }

        result.outcomes = outcomes;

        console.debug('updated node: ', result);
        flowAction.current?.updateNodeProperties(editNodeId, result);
    };

    const handleSaveGraphData = async (publish: boolean = false) => {
        setSubmiting(true);
        const gdata = await flowAction.current?.getGraphData();

        if (gdata?.nodes.length == 0) {
            message.error('No nodes in the graph');
            setSubmiting(false);
            return;
        }

        const { activities, connections } = conventToServerData(gdata!);

        let result = null;
        if (id) {
            result = await updateWorkflowDefinition(id, {
                definition: definition as API.WorkflowDefinitionCreateOrUpdate,
                activities,
                connections,
                isPublished: publish,
            });
        } else {
            result = await createWorkflowDefinition({
                definition: definition as API.WorkflowDefinitionCreateOrUpdate,
                activities,
                connections,
                isPublished: publish,
            });
        }

        if (result) {
            if (publish) {
                message.success('Publish workflow success. version: ' + result.version);
            } else {
                message.success('Save draft successed. version: ' + result.version);
            }
            // new
            if (!id) {
                // message.success('Create successed.');
                history.replace(`/designer?id=${result.definition?.id}`);
            }

            setId(result.definition!.id);
            setVersion(result.version!);
            //
            setDefinitionVersion(result);
            setDefinition(result.definition);
        }

        setSubmiting(false);
    };

    const showCreateModal = () => {
        setEditModalTitle('Create');
        setEditModalVisible(true);
    };

    const loadData = async (did: string, version?: number) => {
        setLoading(true);
        let definitonVersion: API.WorkflowDefinitionVersion;
        if (version) definitonVersion = await getWorkflowDefinitionVersion(did, version);
        else definitonVersion = await getWorkflowDefinition(did);
        //
        setLoading(false);
        if (definitonVersion) {
            setDefinitionVersion(definitonVersion);
            //
            setDefinition(definitonVersion.definition);
            setVersion(definitonVersion.version!);
            //
            await loadServerData(definitonVersion);
        } else {
            history.goBack();
        }
    };

    useEffect(() => {
        // @ts-ignore
        const qid = location.query?.id ?? '';
        setId(qid);
        if (qid) {
            loadData(qid);
        } else {
            showCreateModal();
        }
    }, []);

    return (
        <PageContainer>
            <Card
                onKeyDown={(e) => {
                    e.preventDefault();
                    const charCode = String.fromCharCode(e.which).toLowerCase();
                    if ((e.ctrlKey || e.metaKey) && charCode === 's') {
                        console.log('ctrl+s');
                    }
                }}
            >
                <Spin spinning={loading}>
                    <Row style={{ marginBottom: 15 }}>
                        <Col flex={1} className="title-bar">
                            <Typography.Text>
                                {definition?.name}{' '}
                                <Tag>Draft :{definition?.latestVersion ?? 1}</Tag>
                                {definition?.publishedVersion && (
                                    <Tag> Published :{definition?.publishedVersion}</Tag>
                                )}
                            </Typography.Text>
                        </Col>
                        <Col>
                            {/* <Button
                            type="default"
                            disabled={!basicData?.name}
                            loading={submiting}
                            style={{ marginLeft: 10 }}
                            icon={<SettingOutlined />}
                            onClick={async () => {
                                setEditModalTitle('Edit');
                                setEditModalVisible(true);
                            }}
                        >
                            Settings
                        </Button> */}
                            <Button
                                type="default"
                                disabled={!definition?.name}
                                loading={submiting}
                                style={{ marginLeft: 10 }}
                                icon={<SaveOutlined />}
                                onClick={async () => {
                                    await handleSaveGraphData();
                                }}
                            >
                                Save
                            </Button>
                            <Button
                                type="default"
                                disabled={!definition?.name}
                                loading={submiting}
                                style={{ marginLeft: 10 }}
                                icon={<GlobalOutlined />}
                                onClick={async () => {
                                    await handleSaveGraphData(true);
                                }}
                            >
                                Publish
                            </Button>

                            <Dropdown.Button
                                disabled={submiting || !definition?.name}
                                style={{ marginLeft: 10 }}
                                // icon={<SettingOutlined />}
                                onClick={() => {
                                    setEditModalTitle('Edit');
                                    setEditModalVisible(true);
                                }}
                                overlay={
                                    <Menu>
                                        <Menu.Item
                                            key="1"
                                            onClick={() => {
                                                setVersionListModalVisible(true);
                                            }}
                                            disabled={!id}
                                        >
                                            Versions
                                        </Menu.Item>
                                        <Menu.Divider />
                                        <Menu.Item
                                            key="2"
                                            onClick={() => {
                                                handleOnExport();
                                            }}
                                        >
                                            Export
                                        </Menu.Item>
                                        <Menu.Item key="3">
                                            <Upload
                                                accept=".json"
                                                showUploadList={false}
                                                beforeUpload={(file) => {
                                                    handleOnImport(file);
                                                    return false;
                                                }}
                                            >
                                                Import
                                            </Upload>
                                        </Menu.Item>
                                    </Menu>
                                }
                            >
                                Settings
                            </Dropdown.Button>
                        </Col>
                    </Row>
                    <Flow
                        actionRef={flowAction}
                        graphData={graphData}
                        onNodeDoubleClick={handleOnShowNodeEditForm}
                        height={800}
                    />
                </Spin>
            </Card>
            {/*  */}
            <ModalForm
                layout="horizontal"
                preserve={false}
                labelCol={{ span: 5 }}
                width={600}
                labelWrap
                title={editModalTitle}
                visible={editModalVisible}
                initialValues={definition}
                onVisibleChange={setEditModalVisible}
                onFinish={async (formData) => {
                    setDefinition({ ...definition, ...formData });
                    return true;
                }}
            >
                <EditFormItems />
            </ModalForm>
            {/*  */}
            <ModalForm
                form={editNodeFormRef}
                layout="horizontal"
                modalProps={{ maskClosable: false, destroyOnClose: true }}
                preserve={false}
                labelWrap={true}
                title={nodeTypePropFormTitle}
                labelCol={{ span: 5 }}
                grid={true}
                width={800}
                // request={async () => {
                //     return { success: true, data: editNodeData };
                // }}
                initialValues={editNodeFormData}
                visible={nodeTypePropFormVisible}
                scrollToFirstError
                onVisibleChange={setNodeTypePropFormVisible}
                onFinish={async (formData) => {
                    handleUpdateNodeProperties({
                        ...editNodeFormData,
                        ...formData,
                    } as NodeEditFormData);
                    return true;
                }}
                // onValuesChange={(v) => {
                //     console.log(v);
                // }}
            >
                <NodePropForm
                    workflowDefinitionId={id}
                    properties={nodeTypePropList}
                    getFieldValue={editNodeFormRef.getFieldValue}
                    setFieldsValue={editNodeFormRef.setFieldsValue}
                    setFieldValue={(k, v) => {
                        editNodeFormRef.setFields([{ name: k, value: v }]);
                    }}
                />
            </ModalForm>
            {/*  */}
            <Modal
                title="Version History"
                destroyOnClose
                visible={versionListModalVisible}
                onCancel={() => setVersionListModalVisible(false)}
                width={650}
                onOk={() => {
                    if (oldVersion) {
                        setVersionListModalVisible(false);
                        message.loading('Loading...', 1);
                        loadData(id!, oldVersion);
                    } else {
                        message.error('Please select a version');
                    }
                }}
            >
                <ProTable
                    search={false}
                    toolBarRender={false}
                    rowKey="version"
                    columns={[
                        { title: 'Version', dataIndex: 'version' },
                        {
                            title: 'Latest',
                            dataIndex: 'isLatest',
                            align: 'center',
                            valueEnum: { true: { text: 'Y' }, false: { text: '-' } },
                        },
                        {
                            title: 'Published',
                            dataIndex: 'isPublished',
                            align: 'center',
                            valueEnum: { true: { text: 'Y' }, false: { text: '-' } },
                        },
                        {
                            title: 'Modification Time',
                            dataIndex: 'creationTime',
                            valueType: 'dateTime',
                            width: 160,
                            align: 'center',
                            renderText: (_, record) => {
                                return record.lastModificationTime ?? record.creationTime;
                            },
                        },
                    ]}
                    rowSelection={{
                        type: 'radio',
                        alwaysShowAlert: false,
                        onChange: (keys) => {
                            if (keys.length > 0) {
                                const v = parseInt(keys[0].toString());
                                setOldVersion(v);
                            }
                        },
                    }}
                    tableAlertRender={false}
                    pagination={{ pageSize: 10 }}
                    request={async (params) => {
                        const { current, pageSize } = params;
                        delete params.current;
                        delete params.pageSize;
                        const skipCount = (current! - 1) * pageSize!;
                        const result = await getWorkflowDefinitionVersions(id!, {
                            skipCount,
                            maxResultCount: pageSize,
                        });
                        if (result) {
                            setOldVersion(undefined);
                            return {
                                success: true,
                                data: result.items,
                                total: result.totalCount,
                            };
                        } else {
                            return {
                                success: false,
                            };
                        }
                    }}
                />
            </Modal>
        </PageContainer>
    );
};

export default Index;
